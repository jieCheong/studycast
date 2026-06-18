import { Router, Response } from "express";
import { openai } from "../lib/openai";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

function buildSystemPrompt(mode: string, language: string, lengthMinutes: number): string {
  const wordsPerMinute = 150; // average spoken pace
  const targetWords = lengthMinutes * wordsPerMinute;

  if (mode === "memorization") {
    return `You are creating an audio script designed for passive memorization — the same way people absorb song lyrics without trying, through repeated exposure.

Write in ${language}. Target approximately ${targetWords} words total.

The script MUST follow this exact 3-part structure:

PART 1 - PREVIEW (about 15% of the script):
Briefly introduce all the key terms, concepts, and facts that will be covered, like a "coming up" teaser. Just name them, don't explain yet.

PART 2 - FULL EXPLANATION (about 65% of the script):
Explain each concept naturally and conversationally, with examples and context, as if teaching a curious student.

PART 3 - RAPID RECALL RECAP (about 20% of the script):
Start this section with exactly: "Now let's lock it in. Here are the key things to remember..."
Then go back through every key term, definition, and fact stated clearly and concisely — like reading flashcards aloud. Repeat the most important facts twice in slightly different phrasing if it helps memorization.

Write this as a single continuous spoken script — no headers, no markdown, no stage directions. Just the words to be spoken aloud.`;
  }

  return `You are creating an educational audio script that helps someone deeply understand a topic, the way a great teacher would explain it conversationally.

Write in ${language}. Target approximately ${targetWords} words total.

Explain the material clearly with natural transitions, relevant examples, and logical flow from one idea to the next. Make it engaging to listen to, like a good podcast host explaining something fascinating.

Write this as a single continuous spoken script — no headers, no markdown, no stage directions. Just the words to be spoken aloud.`;
}

router.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const { uploadId, mode, language, length } = req.body;
  const userId = req.userId as string;

  if (!uploadId || !mode || !language || !length) {
    return res.status(400).json({ error: "uploadId, mode, language, and length are required" });
  }

  try {
    // Fetch the extracted text, verifying ownership
    const uploadResult = await pool.query(
      "SELECT extracted_text FROM uploads WHERE id = $1 AND user_id = $2",
      [uploadId, userId]
    );

    if (uploadResult.rows.length === 0) {
      return res.status(404).json({ error: "Upload not found" });
    }

    const extractedText = uploadResult.rows[0].extracted_text;
    if (!extractedText) {
      return res.status(400).json({ error: "This upload has no extracted text yet" });
    }

    // Create the job row
    const jobResult = await pool.query(
      `INSERT INTO jobs (upload_id, user_id, mode, language, length, status) 
       VALUES ($1, $2, $3, $4, $5, 'processing') RETURNING id`,
      [uploadId, userId, mode, language, length]
    );
    const jobId = jobResult.rows[0].id;

    const systemPrompt = buildSystemPrompt(mode, language, parseInt(length));

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Here is the source material:\n\n${extractedText}` },
      ],
      temperature: 0.7,
    });

    const transcript = completion.choices[0]?.message?.content?.trim();

    if (!transcript) {
      await pool.query(
        "UPDATE jobs SET status = 'failed', error_message = $1 WHERE id = $2",
        ["No script was generated", jobId]
      );
      return res.status(500).json({ error: "Failed to generate script" });
    }

    // Save transcript into outputs (audio_url will be filled in on Day 13)
    await pool.query(
      "INSERT INTO outputs (job_id, transcript) VALUES ($1, $2)",
      [jobId, transcript]
    );

    return res.json({ jobId, transcript });
  } catch (err) {
    console.error("Script generation error:", err);
    return res.status(500).json({ error: "Failed to generate script" });
  }
});

export default router;