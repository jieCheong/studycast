import fs from "fs";
import path from "path";
import { performance } from "perf_hooks";
import { pool } from "../db";
import { chunkTextForEmbedding } from "../lib/chunking";
import { generateEmbedding } from "../lib/openai";
import { retrieveRelevantChunks } from "../lib/retrieval";
import { precisionAtK, recallAtK, percentile } from "./metrics";

const EVAL_USER_EMAIL = "eval@studysound.internal";
const TOP_K = 5;
const CORPUS_DIR = path.join(__dirname, "corpus");
const RESULTS_PATH = path.join(__dirname, "RESULTS.md");

// Recorded 2026-09-19, before the corpus was padded with filler docs: 3 labeled docs,
// 33 total chunks in the table. Kept here so RESULTS.md can show latency at small vs.
// realistic scale side by side.
const BASELINE = {
  totalChunks: 33,
  totalDocs: 3,
  avgRecall: 0.988,
  avgPrecision: 0.29,
  p50: 229,
  p95: 409,
};

interface LabeledQuery {
  docFile: string;
  query: string;
  relevantChunkIndices: number[];
}

async function getOrCreateEvalUser(): Promise<string> {
  const existing = await pool.query("SELECT id FROM users WHERE email = $1", [EVAL_USER_EMAIL]);
  if (existing.rows.length > 0) return existing.rows[0].id;

  const inserted = await pool.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
    [EVAL_USER_EMAIL, "eval-account-not-a-real-login"]
  );
  return inserted.rows[0].id;
}

async function getOrCreateUpload(userId: string, filename: string, extractedText: string, reset: boolean): Promise<string> {
  const existing = await pool.query(
    "SELECT id FROM uploads WHERE user_id = $1 AND filename = $2",
    [userId, filename]
  );

  if (existing.rows.length > 0) {
    const uploadId = existing.rows[0].id;
    if (reset) {
      await pool.query("DELETE FROM chunks WHERE upload_id = $1", [uploadId]);
    }
    return uploadId;
  }

  const inserted = await pool.query(
    "INSERT INTO uploads (user_id, filename, extracted_text) VALUES ($1, $2, $3) RETURNING id",
    [userId, filename, extractedText]
  );
  return inserted.rows[0].id;
}

async function embedAndStoreChunks(uploadId: string, userId: string, text: string): Promise<void> {
  const existing = await pool.query("SELECT COUNT(*) AS n FROM chunks WHERE upload_id = $1", [uploadId]);
  if (parseInt(existing.rows[0].n) > 0) {
    console.log(`  already has chunks — skipping embedding`);
    return;
  }

  const textChunks = chunkTextForEmbedding(text);
  for (let i = 0; i < textChunks.length; i++) {
    const embedding = await generateEmbedding(textChunks[i]);
    const embeddingString = `[${embedding.join(",")}]`;
    await pool.query(
      `INSERT INTO chunks (upload_id, user_id, chunk_text, chunk_index, embedding)
       VALUES ($1, $2, $3, $4, $5)`,
      [uploadId, userId, textChunks[i], i, embeddingString]
    );
    process.stdout.write(`\r  embedded ${i + 1}/${textChunks.length} chunks`);
  }
  console.log("");
}

async function seedCorpus(reset: boolean): Promise<{ uploadIdByDocFile: Map<string, string>; userId: string }> {
  const userId = await getOrCreateEvalUser();
  const docFiles = fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".txt"));
  const uploadIdByDocFile = new Map<string, string>();

  for (const docFile of docFiles) {
    console.log(`Seeding ${docFile}...`);
    const text = fs.readFileSync(path.join(CORPUS_DIR, docFile), "utf-8");
    const uploadId = await getOrCreateUpload(userId, docFile, text, reset);
    await embedAndStoreChunks(uploadId, userId, text);
    uploadIdByDocFile.set(docFile, uploadId);
  }

  return { uploadIdByDocFile, userId };
}

async function getCorpusStats(userId: string): Promise<{ totalChunks: number; totalDocs: number }> {
  const chunks = await pool.query("SELECT COUNT(*) AS n FROM chunks WHERE user_id = $1", [userId]);
  const docs = await pool.query("SELECT COUNT(*) AS n FROM uploads WHERE user_id = $1", [userId]);
  return { totalChunks: parseInt(chunks.rows[0].n), totalDocs: parseInt(docs.rows[0].n) };
}

async function runEval(
  uploadIdByDocFile: Map<string, string>,
  corpusStats: { totalChunks: number; totalDocs: number }
): Promise<void> {
  const queries: LabeledQuery[] = JSON.parse(fs.readFileSync(path.join(__dirname, "queries.json"), "utf-8"));

  const rows: { query: string; precision: number; recall: number; latencyMs: number }[] = [];

  for (const { docFile, query, relevantChunkIndices } of queries) {
    const uploadId = uploadIdByDocFile.get(docFile);
    if (!uploadId) throw new Error(`No seeded upload for ${docFile}`);

    const start = performance.now();
    const retrieved = await retrieveRelevantChunks(uploadId, query, TOP_K);
    const latencyMs = performance.now() - start;
    const retrievedIndices = retrieved.map((c) => c.chunkIndex);

    const precision = precisionAtK(retrievedIndices, relevantChunkIndices, TOP_K);
    const recall = recallAtK(retrievedIndices, relevantChunkIndices, TOP_K);
    rows.push({ query, precision, recall, latencyMs });
  }

  const avgPrecision = rows.reduce((sum, r) => sum + r.precision, 0) / rows.length;
  const avgRecall = rows.reduce((sum, r) => sum + r.recall, 0) / rows.length;
  const latencies = rows.map((r) => r.latencyMs);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);

  console.log(`\n${"Query".padEnd(70)}Recall@${TOP_K}  Prec@${TOP_K}  Latency`);
  for (const r of rows) {
    console.log(
      `${r.query.slice(0, 68).padEnd(70)}${r.recall.toFixed(2)}    ${r.precision.toFixed(2)}    ${r.latencyMs.toFixed(0)}ms`
    );
  }
  console.log(`\nQueries evaluated: ${rows.length}`);
  console.log(`Corpus: ${corpusStats.totalDocs} docs, ${corpusStats.totalChunks} chunks`);
  console.log(`Average recall@${TOP_K}: ${avgRecall.toFixed(3)}`);
  console.log(`Average precision@${TOP_K}: ${avgPrecision.toFixed(3)}`);
  console.log(`Retrieval latency p50: ${p50.toFixed(0)}ms`);
  console.log(`Retrieval latency p95: ${p95.toFixed(0)}ms`);

  writeResultsFile(rows, avgPrecision, avgRecall, p50, p95, corpusStats);
}

function writeResultsFile(
  rows: { query: string; precision: number; recall: number; latencyMs: number }[],
  avgPrecision: number,
  avgRecall: number,
  p50: number,
  p95: number,
  corpusStats: { totalChunks: number; totalDocs: number }
): void {
  const lines = [
    "# Retrieval Accuracy Eval Results",
    "",
    `Run date: ${new Date().toISOString().slice(0, 10)}`,
    `Corpus: ${corpusStats.totalDocs} docs, ${corpusStats.totalChunks} chunks`,
    `Queries evaluated: ${rows.length}`,
    `Average recall@${TOP_K}: ${avgRecall.toFixed(3)}`,
    `Average precision@${TOP_K}: ${avgPrecision.toFixed(3)}`,
    `Retrieval latency p50: ${p50.toFixed(0)}ms`,
    `Retrieval latency p95: ${p95.toFixed(0)}ms`,
    "",
    "## Latency at small vs. realistic scale",
    "",
    "Same 42 labeled queries and metrics, run twice against a differently-sized chunks table " +
      "(the labeled docs and their ground truth never changed — only unrelated filler docs were " +
      "added to grow the table).",
    "",
    "| Scale | Docs | Total chunks | Recall@5 | Precision@5 | p50 | p95 |",
    "|---|---|---|---|---|---|---|",
    `| Small (pre-padding) | ${BASELINE.totalDocs} | ${BASELINE.totalChunks} | ${BASELINE.avgRecall.toFixed(3)} | ${BASELINE.avgPrecision.toFixed(3)} | ${BASELINE.p50}ms | ${BASELINE.p95}ms |`,
    `| Realistic | ${corpusStats.totalDocs} | ${corpusStats.totalChunks} | ${avgRecall.toFixed(3)} | ${avgPrecision.toFixed(3)} | ${p50.toFixed(0)}ms | ${p95.toFixed(0)}ms |`,
    "",
    `Latency ${p95 <= BASELINE.p95 * 1.15 ? "held steady" : "degraded"} going from ${BASELINE.totalChunks} to ` +
      `${corpusStats.totalChunks} chunks (a ~${Math.round(corpusStats.totalChunks / BASELINE.totalChunks)}x larger table): ` +
      `p95 went from ${BASELINE.p95}ms to ${p95.toFixed(0)}ms. Retrieval is still scoped to a single upload's chunks ` +
      "per query (`WHERE upload_id = $2`), so growing the total table size mostly stresses whether the HNSW index " +
      "keeps that per-document search fast rather than falling back to a full scan.",
    "",
    `Note: this eval corpus has only 1-2 relevant chunks per query out of 10-12 chunks per labeled doc, ` +
      `so precision@${TOP_K} is mechanically capped well below 1.0 even for perfect retrieval ` +
      `(1-2 hits out of a ${TOP_K}-wide window). Recall@${TOP_K} is the metric that reflects whether ` +
      "retrieval actually surfaced the relevant chunks, and is the one to cite.",
    "",
    `Note: latency is measured end-to-end around \`retrieveRelevantChunks\`, which includes the ` +
      "OpenAI query-embedding API call over the network, not just the pgvector similarity search. " +
      "It's a fair number for \"time from query to retrieved chunks,\" but don't cite it as pure database latency.",
    "",
    "## Per-query results (realistic-scale run)",
    "",
    "| Query | Recall@5 | Precision@5 | Latency |",
    "|---|---|---|---|",
    ...rows.map(
      (r) => `| ${r.query} | ${r.recall.toFixed(2)} | ${r.precision.toFixed(2)} | ${r.latencyMs.toFixed(0)}ms |`
    ),
    "",
  ];
  fs.writeFileSync(RESULTS_PATH, lines.join("\n"));
  console.log(`\nResults written to ${RESULTS_PATH}`);
}

async function main() {
  const reset = process.argv.includes("--reset");
  const { uploadIdByDocFile, userId } = await seedCorpus(reset);
  const corpusStats = await getCorpusStats(userId);
  await runEval(uploadIdByDocFile, corpusStats);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
