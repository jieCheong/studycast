import { Router, Response } from "express";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { pipelineQueue } from "../lib/queue";
import { validateBody } from "../middleware/validate";
import { createJobSchema } from "../schemas/jobs.schema";

const router = Router();

router.post("/", requireAuth, validateBody(createJobSchema),async (req: AuthRequest, res: Response) => {
  const { uploadId, mode, language, length, voice } = req.body;
  const userId = req.userId as string;

  if (!uploadId || !mode || !language || !length) {
    return res.status(400).json({ error: "uploadId, mode, language, and length are required" });
  }

  try {
    // Verify ownership before queueing anything
    const uploadCheck = await pool.query(
      "SELECT id FROM uploads WHERE id = $1 AND user_id = $2",
      [uploadId, userId]
    );
    if (uploadCheck.rows.length === 0) {
      return res.status(404).json({ error: "Upload not found" });
    }

    // Check daily free-tier limit — configurable via FREE_GENERATION_LIMIT env var
    const freeLimit = parseInt(process.env.FREE_GENERATION_LIMIT ?? "2");
    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM jobs
       WHERE user_id = $1 AND status = 'complete' AND created_at >= CURRENT_DATE`,
      [userId]
    );
    if (parseInt(countResult.rows[0].count) >= freeLimit) {
      return res.status(403).json({ error: "You've used all free generations for today." });
    }

    // Create the Postgres job row first — this is our source of truth
    const jobResult = await pool.query(
      `INSERT INTO jobs (upload_id, user_id, mode, language, length, voice, status) 
       VALUES ($1, $2, $3, $4, $5, $6, 'queued') RETURNING id`,
      [uploadId, userId, mode, language, length, voice || null]
    );
    const jobId = jobResult.rows[0].id;

    // Push the actual work onto the BullMQ queue
    await pipelineQueue.add("process-pipeline", {
      jobId,
      uploadId,
      userId,
      mode,
      language,
      length,
      voice,
    });

    // Respond immediately — the worker handles everything from here
    return res.status(202).json({ jobId, status: "queued" });
  } catch (err) {
    console.error("Job creation error:", err);
    return res.status(500).json({ error: "Failed to create job" });
  }
});

router.get("/:id/status", requireAuth, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const userId = req.userId as string;

  try {
    const result = await pool.query(
      `SELECT j.id, j.status, j.error_message, o.transcript, o.audio_url, o.id as output_id
       FROM jobs j
       LEFT JOIN outputs o ON o.job_id = j.id
       WHERE j.id = $1 AND j.user_id = $2`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Job not found" });
    }

    const row = result.rows[0];

    let audioUrl = null;
    if (row.audio_url) {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
      const { s3, BUCKET_NAME } = await import("../lib/s3");
      audioUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: BUCKET_NAME, Key: row.audio_url }),
        { expiresIn: 60 * 60 }
      );
    }

    return res.json({
      jobId: row.id,
      status: row.status,
      errorMessage: row.error_message,
      transcript: row.transcript || null,
      audioUrl,
    });
  } catch (err) {
    console.error("Job status fetch error:", err);
    return res.status(500).json({ error: "Failed to fetch job status" });
  }
});

export default router;