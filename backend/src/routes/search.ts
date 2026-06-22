import { Router, Response } from "express";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { retrieveRelevantChunks } from "../lib/retrieval";
import { pool } from "../db";
import { validateBody } from "../middleware/validate";
import { z } from "zod";

const router = Router();

const searchSchema = z.object({
    uploadId: z.string().uuid(),
    query: z.string().min(1, "Query is required"),
});

router.post("/", requireAuth, validateBody(searchSchema), async (req: AuthRequest, res: Response) => {
    const { uploadId, query } = req.body;
    const userId = req.userId as string;

    try {
        const uploadCheck = await pool.query(
            "SELECT id FROM uploads WHERE id = $1 AND user_id = $2",
            [uploadId, userId]
        );
        if (uploadCheck.rows.length === 0) {
            return res.status(404).json({ error: "Upload not found"});
        }
        const chunks = await retrieveRelevantChunks(uploadId, query, 5);

        return res.json({ query, results: chunks });
    } catch (err) {
        console.error("Search error:", err);
        return res.status(500).json({ error: "Search failed" });
    }
});
export default router;