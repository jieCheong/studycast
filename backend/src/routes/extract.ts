import { Router, Response } from "express";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3, BUCKET_NAME } from "../lib/s3";
import { geminiModel } from "../lib/gemini";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { OfficeParser } from "officeparser";

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
    const uploadResult = await pool.query(
      "SELECT id, file_path, filename FROM uploads WHERE id = $1 AND user_id = $2",
      [uploadId, userId]
    );

    if (uploadResult.rows.length === 0) {
      return res.status(404).json({ error: "Upload not found" });
    }

    const upload = uploadResult.rows[0];

    const s3Response = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET_NAME, Key: upload.file_path })
    );

    const fileBuffer = await streamToBuffer(s3Response.Body);
    const filename = upload.filename.toLowerCase();

    let extractedText: string;

    if (filename.endsWith(".pdf")) {
      // Gemini handles PDFs well (including scanned/image-based PDFs)
      const base64File = fileBuffer.toString("base64");
      const result = await geminiModel.generateContent([
        { inlineData: { mimeType: "application/pdf", data: base64File } },
        {
          text: `Extract ALL text content from this document.
Return ONLY the extracted text, preserving the logical structure and order of the content.
Do not add commentary, summaries, or formatting like markdown.
Do not include page numbers or headers/footers that repeat on every page.
Just return the raw text content.`,
        },
      ]);
      extractedText = result.response.text().trim();
    } else {
      // PPTX / DOCX — Gemini rejects these MIME types; use officeparser instead
      const fileType = filename.endsWith(".pptx") ? "pptx" : "docx";
      const ast = await OfficeParser.parseOffice(fileBuffer, { fileType });
      extractedText = ((await ast.to("text")).value as string).trim();
    }

    if (!extractedText || extractedText.length < 50) {
      return res.status(422).json({
        error: "Could not extract enough text from this file. Try a different file.",
      });
    }

    const cappedText = extractedText.slice(0, 50000);

    await pool.query(
      "UPDATE uploads SET extracted_text = $1 WHERE id = $2",
      [cappedText, uploadId]
    );

    return res.json({ text: cappedText, length: cappedText.length });
  } catch (err) {
    console.error("Extraction error:", err);
    return res.status(500).json({ error: "Failed to extract text from file" });
  }
});

export default router;
