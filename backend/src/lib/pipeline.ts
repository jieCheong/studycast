import { pool } from "../db";
import { s3, BUCKET_NAME } from "./s3";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { openai } from "./openai";
import { logger } from "./logger";
import { generateEmbedding } from "./openai";
import { chunkTextForEmbedding } from "./chunking";
import { retrieveAllChunksOrdered, selectChunksWithinBudget } from "./retrieval";
import { transcribeVideoAudio } from "./openai";
import { PipelineJobData } from "./queue";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function chunkTextForTTS(text: string, maxChars = 4096): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }
    let splitIndex = remaining.lastIndexOf(". ", maxChars);
    if (splitIndex === -1) splitIndex = maxChars;
    chunks.push(remaining.slice(0, splitIndex + 1));
    remaining = remaining.slice(splitIndex + 1).trim();
  }
  return chunks;
}

export function buildSystemPrompt(mode: string, language: string, lengthMinutes: number): string {
  const wordsPerMinute = 150;
  const targetWords = lengthMinutes * wordsPerMinute;

  if (mode === "memorization") {
    return `You are creating an audio script designed for passive memorization. Write in ${language}. Target approximately ${targetWords} words.

PART 1 - PREVIEW (15%): Briefly introduce all key terms and concepts.
PART 2 - FULL EXPLANATION (65%): Explain naturally with examples.
PART 3 - RAPID RECALL RECAP (20%): Start with "Now let's lock it in. Here are the key things to remember..." then restate every key term and fact clearly.

Write as continuous spoken script — no headers, no markdown.`;
  }

  return `You are creating an educational audio script for deep understanding. Write in ${language}. Target approximately ${targetWords} words. Explain clearly with natural transitions and examples, like a great podcast host. Write as continuous spoken script — no headers, no markdown.`;
}

async function updateJobStatus(jobId: string, status: string, errorMessage?: string) {
  if (status === "failed") {
    await pool.query(
      "UPDATE jobs SET status = $1, error_message = $2 WHERE id = $3",
      [status, errorMessage || null, jobId]
    );
  } else {
    await pool.query("UPDATE jobs SET status = $1 WHERE id = $2", [status, jobId]);
  }
}

export type ProgressReporter = (step: string, percent: number) => Promise<void> | void;

// The full async generation pipeline: extract (if needed) -> chunk/embed -> RAG script
// generation -> TTS -> S3 upload. Shared between the BullMQ worker and any tooling that
// needs to run the exact same pipeline in-process (e.g. latency benchmarking), so the two
// execution paths can never silently drift apart.
export async function runPipelineJob(
  data: PipelineJobData,
  onProgress: ProgressReporter = () => {}
): Promise<{ success: true; outputId: string; s3Key: string }> {
  const { jobId, uploadId, userId, mode, language, length, voice } = data;

  try {
    // STEP 1: Extract text (skip if already extracted, e.g. for YouTube uploads)
    await onProgress("extracting", 10);
    logger.info({ jobId, step: "extracting" }, "Job processing step");
    await updateJobStatus(jobId, "processing");

    let uploadResult = await pool.query(
      "SELECT extracted_text, file_path, filename FROM uploads WHERE id = $1 AND user_id = $2",
      [uploadId, userId]
    );

    // Retry with backoff to absorb potential replication lag between
    // the API's write and this worker's read, especially relevant with
    // serverless Postgres providers like Neon
    let retries = 0;
    const maxRetries = 3;
    while (uploadResult.rows.length === 0 && retries < maxRetries) {
      retries++;
      logger.info({ jobId, uploadId, retries }, "Upload not found yet, retrying after delay");
      await new Promise((resolve) => setTimeout(resolve, 500 * retries)); // 500ms, 1000ms, 1500ms
      uploadResult = await pool.query(
        "SELECT extracted_text, file_path, filename FROM uploads WHERE id = $1 AND user_id = $2",
        [uploadId, userId]
      );
    }

    if (uploadResult.rows.length === 0) throw new Error("Upload not found");

    let extractedText = uploadResult.rows[0].extracted_text;

    if (!extractedText) {
      const { file_path, filename } = uploadResult.rows[0];
      const s3Response = await s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: file_path }));
      const fileBuffer = await streamToBuffer(s3Response.Body);

      const lower = filename.toLowerCase();
      const isVideo = lower.endsWith(".mp4") || lower.endsWith(".mov") || lower.endsWith(".webm");

      if (isVideo) {
        extractedText = (await transcribeVideoAudio(fileBuffer, filename)).trim().slice(0, 50000);
      } else {
        const { OfficeParser } = await import("officeparser");
        const ast = await OfficeParser.parseOffice(fileBuffer);
        extractedText = (await ast.to("text")).value.trim().slice(0, 50000);
      }

      if (!extractedText || extractedText.length < 50) throw new Error("Could not extract enough text");
      await pool.query("UPDATE uploads SET extracted_text = $1 WHERE id = $2", [extractedText, uploadId]);
    }
    await onProgress("embedding", 25);
    await updateJobStatus(jobId, "embedding");
    logger.info({ jobId, step: "embedding" }, "Job processing step");

    const existingChunks = await pool.query("SELECT id FROM chunks WHERE upload_id = $1 LIMIT 1", [uploadId]);

    if (existingChunks.rows.length === 0) {
      const textChunks = chunkTextForEmbedding(extractedText);

      for (let i = 0; i < textChunks.length; i++) {
        const embedding = await generateEmbedding(textChunks[i]);
        const embeddingString = `[${embedding.join(",")}]`;

        await pool.query(
          `INSERT INTO chunks (upload_id, user_id, chunk_text, chunk_index, embedding)
           VALUES ($1, $2, $3, $4, $5)`,
          [uploadId, userId, textChunks[i], i, embeddingString]
        );
      }
      logger.info({ jobId, chunkCount: textChunks.length }, "Embeddings generated and stored");
    }

    // STEP 2: Generate script — using RAG retrieval instead of dumping full extracted text
    await onProgress("generating-script", 40);
    await updateJobStatus(jobId, "generating-script");
    logger.info({ jobId, step: "generating-script" }, "Job processing step");

    const allChunks = await retrieveAllChunksOrdered(uploadId);
    const budgetedChunks = selectChunksWithinBudget(allChunks, 12000);
    const retrievedContext = budgetedChunks.map((c) => c.chunkText).join("\n\n");

    logger.info(
      { jobId, totalChunks: allChunks.length, usedChunks: budgetedChunks.length },
      "Chunks selected for script generation"
    );

    const systemPrompt = buildSystemPrompt(mode, language, parseInt(length));
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Source material:\n\n${retrievedContext}` },
      ],
      temperature: 0.7,
    });

    const transcript = completion.choices[0]?.message?.content?.trim();
    if (!transcript) throw new Error("No script was generated");

    const outputResult = await pool.query(
      "INSERT INTO outputs (job_id, transcript) VALUES ($1, $2) RETURNING id",
      [jobId, transcript]
    );
    const outputId = outputResult.rows[0].id;

    // STEP 3: Generate audio
    await onProgress("generating-audio", 70);
    await updateJobStatus(jobId, "generating-audio");
    logger.info({ jobId, step: "generating-audio" }, "Job processing step");

    const usedVoice = voice || "alloy";
    const ttsChunks = chunkTextForTTS(transcript);
    const audioBuffers: Buffer[] = [];

    for (const chunk of ttsChunks) {
      const response = await openai.audio.speech.create({
        model: "tts-1",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        voice: usedVoice as any,
        input: chunk,
        response_format: "mp3",
      });
      audioBuffers.push(Buffer.from(await response.arrayBuffer()));
    }

    const fullAudioBuffer = Buffer.concat(audioBuffers);
    const s3Key = `audio/${jobId}.mp3`;

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: fullAudioBuffer,
      ContentType: "audio/mpeg",
    }));

    await pool.query(
      "UPDATE outputs SET audio_url = $1, duration_seconds = $2 WHERE id = $3",
      [s3Key, Math.round(transcript.split(" ").length / 2.5), outputId]
    );

    await pool.query("UPDATE jobs SET status = 'complete', completed_at = NOW() WHERE id = $1", [jobId]);
    await onProgress("complete", 100);

    return { success: true, outputId, s3Key };
  } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? err.stack : undefined;
    logger.error({ jobId, err: errMessage, stack: errStack }, "Pipeline job failed");
    await updateJobStatus(jobId, "failed", errMessage);
    throw err;
  }
}
