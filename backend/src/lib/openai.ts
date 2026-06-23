import OpenAI from "openai";
import dotenv from "dotenv";
import fs from "fs";
import os from "os";
import path from "path";

dotenv.config();

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

export async function transcribeVideoAudio(buffer: Buffer, filename: string): Promise<string> {
  // Whisper's SDK requires a file-like object, not a raw buffer —
  // writing to a temp file is the simplest reliable way to satisfy that
  const tempPath = path.join(os.tmpdir(), `whisper-${Date.now()}-${filename}`);
  fs.writeFileSync(tempPath, buffer);

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: "whisper-1",
    });
    return transcription.text;
  } finally {
    fs.unlinkSync(tempPath); // always clean up the temp file, even if transcription fails
  }
}