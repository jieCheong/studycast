import { Router, Response } from "express";
import multer from "multer";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { s3, BUCKET_NAME } from "../lib/s3";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "video/mp4",
  "video/quicktime", // .mov
  "video/webm",
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, PPTX, DOCX, MP4, MOV, and WEBM files are supported"));
    }
  },
});

router.post("/", requireAuth, upload.single("file"), async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file was uploaded" });
  }

  const userId = req.userId as string;
  const timestamp = Date.now();
  const safeFilename = req.file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const s3Key = `${userId}/${timestamp}_${safeFilename}`;

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      })
    );

    const result = await pool.query(
      "INSERT INTO uploads (user_id, filename, file_path) VALUES ($1, $2, $3) RETURNING id, filename, created_at",
      [userId, req.file.originalname, s3Key]
    );

    const newUpload = result.rows[0];

    return res.status(201).json({
      uploadId: newUpload.id,
      filename: newUpload.filename,
      filePath: s3Key,
    });
  } catch (err) {
    console.error("Upload error:", err);
    return res.status(500).json({ error: "Failed to upload file" });
  }
});

export default router;