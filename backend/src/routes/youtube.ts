import { Router, Response } from "express";
import { fetchYouTubeTranscript, YouTubeTranscriptError } from "../lib/youtube-transcript";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { youtubeSchema } from "../schemas/jobs.schema";

const router = Router();

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

router.post("/", requireAuth, validateBody(youtubeSchema), async (req: AuthRequest, res: Response) => {
  const { youtubeUrl } = req.body;
  const userId = req.userId as string;

  if (!youtubeUrl) {
    return res.status(400).json({ error: "youtubeUrl is required" });
  }

  const videoId = extractVideoId(youtubeUrl);
  if (!videoId) {
    return res.status(400).json({ error: "Could not parse a YouTube video ID from that URL" });
  }

  try {
    const fullText = await fetchYouTubeTranscript(videoId);

    if (!fullText || fullText.length < 50) {
      return res.status(422).json({
        error: "This video's transcript is too short to generate useful audio from.",
      });
    }

    const cappedText = fullText.slice(0, 50000);

    const result = await pool.query(
      "INSERT INTO uploads (user_id, filename, extracted_text) VALUES ($1, $2, $3) RETURNING id, filename, created_at",
      [userId, `YouTube: ${videoId}`, cappedText]
    );

    const newUpload = result.rows[0];

    return res.status(201).json({
      uploadId: newUpload.id,
      filename: newUpload.filename,
      text: cappedText,
      length: cappedText.length,
    });
  } catch (err: any) {
    console.error("YouTube transcript error:", err);

    if (err instanceof YouTubeTranscriptError) {
      if (err.code === "VIDEO_UNAVAILABLE") {
        return res.status(422).json({
          error: "This video is unavailable or private. Please check the URL and try again.",
        });
      }
      if (err.code === "NO_CAPTIONS") {
        return res.status(422).json({
          error: "This video doesn't have captions available. Try a different video or upload the file directly.",
        });
      }
      if (err.code === "NETWORK_ERROR") {
        return res.status(503).json({
          error: "Could not reach YouTube. Please check your connection and try again.",
        });
      }
    }

    return res.status(500).json({
      error: "Could not fetch this video's transcript. It may be private, age-restricted, or have captions disabled.",
    });
  }
});

export default router;
