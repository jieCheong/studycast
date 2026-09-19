// Reconstructs real per-episode cost from data already persisted by the throughput test's
// 50 real jobs — no new API calls, no new logging. Chunking/retrieval/prompt-building are
// deterministic, so the exact model inputs can be rebuilt from the real `chunks` and
// `extracted_text` rows; the real `outputs.transcript` is the exact model output. A real
// tokenizer (js-tiktoken) then gives exact token counts, not an approximation.
import fs from "fs";
import path from "path";
import { encodingForModel, getEncoding } from "js-tiktoken";
import { pool } from "../db";
import { retrieveAllChunksOrdered, selectChunksWithinBudget } from "../lib/retrieval";
import { buildSystemPrompt, chunkTextForTTS } from "../lib/pipeline";

const RESULTS_PATH = path.join(__dirname, "COST_RESULTS.md");
const LOADTEST_USER_EMAIL = "loadtest@studysound.internal";
const PROJECTED_LENGTH_MINUTES = 10;

// Real OpenAI pricing at time of writing (platform.openai.com/docs/pricing), per token/char.
const PRICE_PER_TOKEN = {
  chatInput: 0.15 / 1_000_000,
  chatOutput: 0.6 / 1_000_000,
  embedding: 0.02 / 1_000_000,
};
const PRICE_PER_TTS_CHAR = 15.0 / 1_000_000;
const PRICE_PER_WHISPER_MINUTE = 0.006; // not exercised by these jobs (extracted_text was pre-populated)

const chatEncoding = encodingForModel("gpt-4o-mini"); // o200k_base
const embeddingEncoding = getEncoding("cl100k_base"); // text-embedding-3-small's encoding

interface JobRow {
  jobId: string;
  uploadId: string;
  length: string;
  transcript: string;
}

interface JobCost {
  jobId: string;
  chatInputTokens: number;
  chatOutputTokens: number;
  embeddingTokens: number;
  ttsChars: number;
  chatInputCost: number;
  chatOutputCost: number;
  embeddingCost: number;
  ttsCost: number;
  totalCost: number;
}

async function fetchLoadtestJobs(): Promise<JobRow[]> {
  const result = await pool.query(
    `SELECT j.id AS "jobId", j.upload_id AS "uploadId", j.length, o.transcript
     FROM jobs j
     JOIN outputs o ON o.job_id = j.id
     JOIN users u ON u.id = j.user_id
     WHERE u.email = $1 AND o.transcript IS NOT NULL
     ORDER BY j.created_at`,
    [LOADTEST_USER_EMAIL]
  );
  return result.rows;
}

async function costForJob(row: JobRow): Promise<JobCost> {
  // Reconstruct the exact chat input: same retrieval + budgeting the real job used.
  const allChunks = await retrieveAllChunksOrdered(row.uploadId);
  const budgetedChunks = selectChunksWithinBudget(allChunks, 12000);
  const retrievedContext = budgetedChunks.map((c) => c.chunkText).join("\n\n");
  const systemPrompt = buildSystemPrompt("understanding", "English", parseInt(row.length));
  const userMessage = `Source material:\n\n${retrievedContext}`;

  const chatInputTokens = chatEncoding.encode(systemPrompt).length + chatEncoding.encode(userMessage).length;
  const chatOutputTokens = chatEncoding.encode(row.transcript).length;
  const embeddingTokens = allChunks.reduce((sum, c) => sum + embeddingEncoding.encode(c.chunkText).length, 0);

  const ttsChunks = chunkTextForTTS(row.transcript);
  const ttsChars = ttsChunks.reduce((sum, c) => sum + c.length, 0);

  const chatInputCost = chatInputTokens * PRICE_PER_TOKEN.chatInput;
  const chatOutputCost = chatOutputTokens * PRICE_PER_TOKEN.chatOutput;
  const embeddingCost = embeddingTokens * PRICE_PER_TOKEN.embedding;
  const ttsCost = ttsChars * PRICE_PER_TTS_CHAR;

  return {
    jobId: row.jobId,
    chatInputTokens,
    chatOutputTokens,
    embeddingTokens,
    ttsChars,
    chatInputCost,
    chatOutputCost,
    embeddingCost,
    ttsCost,
    totalCost: chatInputCost + chatOutputCost + embeddingCost + ttsCost,
  };
}

function avg(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function writeResults(costs: JobCost[]): void {
  const n = costs.length;
  const avgChatInputTokens = avg(costs.map((c) => c.chatInputTokens));
  const avgChatOutputTokens = avg(costs.map((c) => c.chatOutputTokens));
  const avgEmbeddingTokens = avg(costs.map((c) => c.embeddingTokens));
  const avgTtsChars = avg(costs.map((c) => c.ttsChars));

  const avgChatInputCost = avg(costs.map((c) => c.chatInputCost));
  const avgChatOutputCost = avg(costs.map((c) => c.chatOutputCost));
  const avgEmbeddingCost = avg(costs.map((c) => c.embeddingCost));
  const avgTtsCost = avg(costs.map((c) => c.ttsCost));
  const avgTotalCost = avg(costs.map((c) => c.totalCost));

  // Projection: chat-input and embedding cost are independent of requested script length
  // (fixed 12k-token context budget, fixed source doc); chat-output and TTS scale with it,
  // since buildSystemPrompt's target word count is lengthMinutes * 150. These jobs all
  // requested length=1, so scale those two components linearly to project a longer episode.
  const scale = PROJECTED_LENGTH_MINUTES / 1;
  const projectedChatOutputCost = avgChatOutputCost * scale;
  const projectedTtsCost = avgTtsCost * scale;
  const projectedTotalCost = avgChatInputCost + avgEmbeddingCost + projectedChatOutputCost + projectedTtsCost;

  const fmt = (n: number) => `$${n.toFixed(5)}`;

  const lines = [
    "# Cost Per Episode",
    "",
    `Run date: ${new Date().toISOString().slice(0, 10)}`,
    `Computed from ${n} real jobs (the throughput test's loadtest run) — no new API calls made.`,
    "",
    "## Method",
    "",
    "Chunking, retrieval, and prompt-building are deterministic, so the exact chat input each real job " +
      "sent to GPT-4o-mini was reconstructed from the real persisted `chunks` rows; the real persisted " +
      "`outputs.transcript` is the exact model output. Token counts use `js-tiktoken` (OpenAI's real " +
      "tokenizer: o200k_base for gpt-4o-mini, cl100k_base for text-embedding-3-small) — not word-count " +
      "approximations. Pricing is OpenAI's published per-token/per-character rate at time of writing.",
    "",
    "| Component | Price | Avg. real usage (1-min episode, n=" + n + ") | Avg. real cost |",
    "|---|---|---|---|",
    `| Chat input (GPT-4o-mini) | $0.15/1M tokens | ${avgChatInputTokens.toFixed(0)} tokens | ${fmt(avgChatInputCost)} |`,
    `| Chat output (GPT-4o-mini) | $0.60/1M tokens | ${avgChatOutputTokens.toFixed(0)} tokens | ${fmt(avgChatOutputCost)} |`,
    `| Embeddings (text-embedding-3-small) | $0.02/1M tokens | ${avgEmbeddingTokens.toFixed(0)} tokens | ${fmt(avgEmbeddingCost)} |`,
    `| TTS (tts-1) | $15.00/1M chars | ${avgTtsChars.toFixed(0)} chars | ${fmt(avgTtsCost)} |`,
    `| **Total** | | | **${fmt(avgTotalCost)}** |`,
    "",
    `## Measured: cost per 1-minute episode — **${fmt(avgTotalCost)}**`,
    "",
    "This is the real, exact cost (given current pricing) of the 1-minute-target episodes the " +
      "throughput test actually generated — not a projection.",
    "",
    `## Projected: cost per ${PROJECTED_LENGTH_MINUTES}-minute episode — **${fmt(projectedTotalCost)}**`,
    "",
    "This is a linear projection, not a new measurement: chat-input cost and embedding cost don't " +
      "change with requested episode length (the retrieval context budget is fixed at 12k tokens " +
      "regardless of `length`), so they're carried over unchanged. Chat-output and TTS cost scale " +
      `with length (the script's target word count is \`length_minutes * 150\`), so they're scaled ${scale}x. ` +
      "Actual GPT output length varies run to run around that target, so treat this as a reasonable " +
      "estimate, not an exact figure — cite the 1-minute number as \"measured\" and this one as " +
      "\"projected\" if both go on a resume.",
    "",
    "## Not exercised by these jobs",
    "",
    `- **Whisper transcription** ($${PRICE_PER_WHISPER_MINUTE}/minute of audio) only runs for video ` +
      "uploads without pre-extracted text — every test job pre-populated `extracted_text`, so this " +
      "path was never hit. Real cost for a video-based episode would add this on top.",
    "",
  ];
  fs.writeFileSync(RESULTS_PATH, lines.join("\n"));
  console.log(`Results written to ${RESULTS_PATH}`);
}

async function main() {
  const jobs = await fetchLoadtestJobs();
  if (jobs.length === 0) {
    console.error("No loadtest jobs with outputs found — run `npm run eval:throughput` first.");
    process.exit(1);
  }
  console.log(`Found ${jobs.length} real jobs with persisted output. Computing costs...`);

  const costs: JobCost[] = [];
  for (const job of jobs) {
    costs.push(await costForJob(job));
  }

  writeResults(costs);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
