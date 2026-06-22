import { Router, Response } from "express";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, BUCKET_NAME } from "../lib/s3";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.userId as string;

  try {
    const result = await pool.query(
      `SELECT
         j.id as job_id,
         j.upload_id,
         j.mode,
         j.created_at,
         u.filename,
         o.transcript,
         o.audio_url,
         o.duration_seconds
       FROM jobs j
       JOIN uploads u ON u.id = j.upload_id
       JOIN outputs o ON o.job_id = j.id
       WHERE j.user_id = $1 AND j.status = 'complete'
       ORDER BY j.created_at DESC
       LIMIT 5`,
      [userId]
    );

    // Regenerate fresh presigned URLs for each (stored audio_url is just the S3 key)
    const history = await Promise.all(
      result.rows.map(async (row) => {
        let freshAudioUrl = null;
        if (row.audio_url) {
          freshAudioUrl = await getSignedUrl(
            s3,
            new GetObjectCommand({ Bucket: BUCKET_NAME, Key: row.audio_url }),
            { expiresIn: 60 * 60 } // 1 hour, just for this page view
          );
        }
        return {
          jobId: row.job_id,
          uploadId: row.upload_id,
          filename: row.filename,
          mode: row.mode,
          createdAt: row.created_at,
          durationSeconds: row.duration_seconds,
          audioUrl: freshAudioUrl,
        };
      })
    );

    return res.json({ history });
  } catch (err) {
    console.error("History fetch error:", err);
    return res.status(500).json({ error: "Failed to fetch history" });
  }
});

export default router;