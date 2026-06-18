import { Router, Response } from "express";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3, BUCKET_NAME } from "../lib/s3";
import { geminiModel } from "../lib/gemini";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

router.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const { uploadId } = req.body;
  const userId = req.userId as string;

  if (!uploadId) {
    return res.status(400).json({ error: "uploadId is required" });
  }

  try {
    // Fetch the upload record — and verify it belongs to this user
    const uploadResult = await pool.query(
      "SELECT id, file_path, filename FROM uploads WHERE id = $1 AND user_id = $2",
      [uploadId, userId]
    );

    if (uploadResult.rows.length === 0) {
      return res.status(404).json({ error: "Upload not found" });
    }

    const upload = uploadResult.rows[0];

    // Download file from S3
    const s3Response = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: upload.file_path,
      })
    );

    const fileBuffer = await streamToBuffer(s3Response.Body);
    const base64File = fileBuffer.toString("base64");

    // Detect MIME type from filename
    const filename = upload.filename.toLowerCase();
    let mimeType = "application/pdf";
    if (filename.endsWith(".pptx")) {
      mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    } else if (filename.endsWith(".docx")) {
      mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }

    // Send to Gemini for text extraction
    const result = await geminiModel.generateContent([
      {
        inlineData: {
          mimeType,
          data: base64File,
        },
      },
      {
        text: `Extract ALL text content from this document. 
Return ONLY the extracted text, preserving the logical structure and order of the content.
Do not add commentary, summaries, or formatting like markdown.
Do not include page numbers or headers/footers that repeat on every page.
Just return the raw text content.`,
      },
    ]);

    const extractedText = result.response.text().trim();

    if (!extractedText || extractedText.length < 50) {
      return res.status(422).json({
        error: "Could not extract enough text from this file. Try a different file.",
      });
    }

    // Cap at 50,000 chars to avoid blowing up the script generation prompt
    const cappedText = extractedText.slice(0, 50000);

    // Save extracted text back to the uploads row
    await pool.query(
      "UPDATE uploads SET extracted_text = $1 WHERE id = $2",
      [cappedText, uploadId]
    );

    return res.json({
      text: cappedText,
      length: cappedText.length,
    });
  } catch (err) {
    console.error("Extraction error:", err);
    return res.status(500).json({ error: "Failed to extract text from file" });
  }
});

export default router;