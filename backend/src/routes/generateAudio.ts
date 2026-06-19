import { Router, Response } from "express";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, BUCKET_NAME } from "../lib/s3";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { openai } from "../lib/openai";

const router = Router();

const voiceMap: Record<string, string> = {
  lecture: "onyx",
  podcast: "echo",
  calm: "shimmer",
  energetic: "nova",
};

const DEFAULT_VOICE = "onyx";

function chunkText(text: string, maxChars = 4096): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }
    // Find the last sentence boundary before maxChars
    let splitIndex = remaining.lastIndexOf(". ", maxChars);
    if (splitIndex === -1) splitIndex = maxChars;
    chunks.push(remaining.slice(0, splitIndex + 1));
    remaining = remaining.slice(splitIndex + 1).trim();
  }

  return chunks;
}

async function generateAudioChunk(text: string, voice: string): Promise<Buffer> {
  const response = await openai.audio.speech.create({
    model: "tts-1",
    voice: voice as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer",
    input: text,
    response_format: "mp3",
  });

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

router.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const { jobId, voice } = req.body;
  const userId = req.userId as string;

  if (!jobId) {
    return res.status(400).json({ error: "jobId is required" });
  }

  try {
    // Verify ownership and fetch the transcript
    const jobResult = await pool.query(
      `SELECT j.id, o.transcript, o.id as output_id 
       FROM jobs j JOIN outputs o ON o.job_id = j.id 
       WHERE j.id = $1 AND j.user_id = $2`,
      [jobId, userId]
    );

    if (jobResult.rows.length === 0) {
      return res.status(404).json({ error: "Job not found" });
    }

    const { transcript, output_id } = jobResult.rows[0];
    const usedVoice = voiceMap[voice] ?? DEFAULT_VOICE;

    const chunks = chunkText(transcript);
    const audioBuffers: Buffer[] = [];

    for (const chunk of chunks) {
      const buffer = await generateAudioChunk(chunk, usedVoice);
      audioBuffers.push(buffer);
    }

    const fullAudioBuffer = Buffer.concat(audioBuffers);

    const s3Key = `audio/${jobId}.mp3`;
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: fullAudioBuffer,
        ContentType: "audio/mpeg",
      })
    );

    // Generate a presigned URL valid for 7 days (bucket is private)
    const presignedUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key }),
      { expiresIn: 60 * 60 * 24 * 7 }
    );

    await pool.query(
      "UPDATE outputs SET audio_url = $1, duration_seconds = $2 WHERE id = $3",
      [s3Key, Math.round(transcript.split(" ").length / 2.5), output_id] // rough estimate, ~150 wpm spoken
    );

    await pool.query("UPDATE jobs SET status = 'complete', completed_at = NOW() WHERE id = $1", [jobId]);

    await pool.query(
      "UPDATE profiles SET generation_count = generation_count + 1, updated_at = NOW() WHERE user_id = $1",
      [userId]
    );

    return res.json({ audioUrl: presignedUrl, s3Key });
  } catch (err) {
    console.error("Audio generation error:", err);
    await pool.query("UPDATE jobs SET status = 'failed', error_message = $1 WHERE id = $2", [
      String(err),
      jobId,
    ]);
    return res.status(500).json({ error: "Failed to generate audio" });
  }
});

export default router;