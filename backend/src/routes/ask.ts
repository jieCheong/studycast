import { Router, Response } from "express";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { retrieveRelevantChunks } from "../lib/retrieval";
import { pool } from "../db";
import { openai } from "../lib/openai";
import { validateBody } from "../middleware/validate";
import { logger } from "../lib/logger";
import { z } from "zod";

const router = Router();

const askSchema = z.object({
  uploadId: z.string().uuid(),
  question: z.string().min(3, "Question must be at least 3 characters"),
});

const RELEVANCE_THRESHOLD = 0.2;

router.post("/", requireAuth, validateBody(askSchema), async (req: AuthRequest, res: Response) => {
  const { uploadId, question } = req.body;
  const userId = req.userId as string;

  try {
    const uploadCheck = await pool.query(
      "SELECT id FROM uploads WHERE id = $1 AND user_id = $2",
      [uploadId, userId]
    );
    if (uploadCheck.rows.length === 0) {
      return res.status(404).json({ error: "Upload not found" });
    }

    // The actual RAG step: retrieve only chunks relevant to THIS question
    const relevantChunks = await retrieveRelevantChunks(uploadId, question, 5);

    if (relevantChunks.length === 0) {
      return res.status(422).json({
        error: "This document hasn't been processed for search yet. Try generating audio from it first.",
      });
    }

    const bestRelevance = 1 - relevantChunks[0].distance;

    if (bestRelevance < RELEVANCE_THRESHOLD) {
        return res.json({
            question,
            answer: "This question doesn't appear to be covered by this document.",
            sourceChunks: [],
            belowThreshold: true,
        });
    }

    const context = relevantChunks
      .map((c, i) => `[Excerpt ${i + 1}]\n${c.chunkText}`)
      .join("\n\n");

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You answer questions using ONLY the provided excerpts from the user's study material.

Guidelines:
- If the excerpts don't contain enough information to answer, say so clearly rather than guessing or using outside knowledge.
- Match the depth of your answer to the question: simple factual questions ("what is X?") can get a short, direct answer. But questions asking to compare, explain a difference, or describe a relationship (e.g. "what's the difference between X and Y", "how does X relate to Y", "why does X happen") require a fuller answer — explain both sides, note what distinguishes them, and give a concrete example from the excerpts if one is available.
- Aim for 2-4 sentences for simple questions, and 4-6 sentences for comparison/explanation questions.
- Cite which excerpt(s) support your answer when helpful.
- Write in clear, natural prose — no bullet points unless the question specifically asks for a list.`,
        },
        {
          role: "user",
          content: `Excerpts from the document:\n\n${context}\n\nQuestion: ${question}`,
        },
      ],
      temperature: 0.3, // lower temperature: we want grounded, consistent answers, not creative ones
      max_tokens: 400,
    });

    const answer = completion.choices[0]?.message?.content?.trim();

    return res.json({
      question,
      answer,
      sourceChunks: relevantChunks.map((c) => ({
        chunkIndex: c.chunkIndex,
        excerpt: c.chunkText.slice(0, 150) + "...",
        relevance: (1 - c.distance).toFixed(3), // convert distance to a more intuitive "relevance score"
      })),
      belowThreshold: false,
    });
  } catch (err) {
    logger.error({ err }, "Ask error");
    return res.status(500).json({ error: "Failed to answer question" });
  }
});

export default router;