import { Pool } from "pg";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function chunkTextForEmbedding(text: string, chunkSize = 1000, overlap = 150): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    let chunk = text.slice(start, end);
    if (end < text.length) {
      const lastPeriod = chunk.lastIndexOf(". ");
      if (lastPeriod > chunkSize * 0.5) chunk = chunk.slice(0, lastPeriod + 1);
    }
    chunks.push(chunk.trim());
    const advance = chunk.length - overlap;
    start += advance > 0 ? advance : chunk.length;
  }
  return chunks.filter((c) => c.length > 20);
}

async function main() {
  const uploadId = process.argv[2];
  if (!uploadId) {
    console.error("Usage: npx tsx src/scripts/seed-embeddings.ts <uploadId>");
    process.exit(1);
  }

  const uploadResult = await pool.query(
    "SELECT id, user_id, filename, extracted_text FROM uploads WHERE id = $1",
    [uploadId]
  );
  if (uploadResult.rows.length === 0) {
    console.error("Upload not found:", uploadId);
    process.exit(1);
  }

  const { user_id, filename, extracted_text } = uploadResult.rows[0];
  if (!extracted_text) {
    console.error("No extracted_text for this upload. Run a job first to extract it.");
    process.exit(1);
  }

  const existing = await pool.query("SELECT COUNT(*) as n FROM chunks WHERE upload_id = $1", [uploadId]);
  if (parseInt(existing.rows[0].n) > 0) {
    console.log(`Already has ${existing.rows[0].n} chunks — nothing to do.`);
    await pool.end();
    return;
  }

  const textChunks = chunkTextForEmbedding(extracted_text);
  console.log(`Embedding ${textChunks.length} chunks for "${filename}"...`);

  for (let i = 0; i < textChunks.length; i++) {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: textChunks[i],
    });
    const embedding = response.data[0].embedding;
    const embeddingString = `[${embedding.join(",")}]`;
    await pool.query(
      `INSERT INTO chunks (upload_id, user_id, chunk_text, chunk_index, embedding)
       VALUES ($1, $2, $3, $4, $5)`,
      [uploadId, user_id, textChunks[i], i, embeddingString]
    );
    process.stdout.write(`\r  chunk ${i + 1}/${textChunks.length}`);
  }

  console.log(`\nDone — ${textChunks.length} chunks stored.`);
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
