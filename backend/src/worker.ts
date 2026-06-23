import { initSentry, Sentry } from "./lib/sentry";
initSentry();

import { Worker, Job } from "bullmq";
import { redisConnection } from "./lib/redis";
import { PipelineJobData } from "./lib/queue";
import { pool } from "./db";
import { s3, BUCKET_NAME } from "./lib/s3";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { geminiModel } from "./lib/gemini";
import { openai } from "./lib/openai";
import { logger } from "./lib/logger";
import { generateEmbedding } from "./lib/openai";
import { chunkTextForEmbedding } from "./lib/chunking";
import { retrieveAllChunksOrdered, selectChunksWithinBudget } from "./lib/retrieval";
import { transcribeVideoAudio } from "./lib/openai";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function chunkTextForTTS(text: string, maxChars = 4096): string[] {
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

function buildSystemPrompt(mode: string, language: string, lengthMinutes: number): string {
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

const worker = new Worker<PipelineJobData>(
  "ai-pipeline",
  async (job: Job<PipelineJobData>) => {
    const { jobId, uploadId, userId, mode, language, length, voice } = job.data;

    try {
      // STEP 1: Extract text (skip if already extracted, e.g. for YouTube uploads)
      await job.updateProgress({ step: "extracting", percent: 10 });
      logger.info({ jobId, step: "extracting" }, "Job processing step");
      await updateJobStatus(jobId, "processing");

      const uploadResult = await pool.query(
        "SELECT extracted_text, file_path, filename FROM uploads WHERE id = $1 AND user_id = $2",
        [uploadId, userId]
      );
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
          const base64File = fileBuffer.toString("base64");

          let mimeType = "application/pdf";
          if (lower.endsWith(".pptx")) mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
          else if (lower.endsWith(".docx")) mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

          const geminiResult = await geminiModel.generateContent([
            { inlineData: { mimeType, data: base64File } },
            { text: "Extract ALL text content from this document. Return ONLY the extracted text, no commentary." },
          ]);

          extractedText = geminiResult.response.text().trim().slice(0, 50000);
        }

        if (!extractedText || extractedText.length < 50) throw new Error("Could not extract enough text");
        await pool.query("UPDATE uploads SET extracted_text = $1 WHERE id = $2", [extractedText, uploadId]);
      }
      await job.updateProgress({ step: "embedding", percent: 25 });
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
      await job.updateProgress({ step: "generating-script", percent: 40 });
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
      await job.updateProgress({ step: "generating-audio", percent: 70 });
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
      await job.updateProgress({ step: "complete", percent: 100 });

      return { success: true, outputId, s3Key };
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      const errStack = err instanceof Error ? err.stack : undefined;
      logger.error({ jobId, err: errMessage, stack: errStack }, "Pipeline job failed");
      Sentry.captureException(err, { extra: { jobId, uploadId, userId } });
      await updateJobStatus(jobId, "failed", errMessage);
      throw err; // re-throw so BullMQ marks it as failed and can retry
    }
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { connection: redisConnection as any, concurrency: 2 } // process up to 2 jobs at once
);

worker.on("completed", (job) => {
  logger.info({ jobId: job.id }, "Job completed");
});

worker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, "Job failed");
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
  Sentry.captureException(reason);
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception");
  Sentry.captureException(err);
});

logger.info("Worker started, listening for jobs");