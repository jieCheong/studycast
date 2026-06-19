import { Router, Response } from "express";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.userId as string;

  try {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM jobs
       WHERE user_id = $1 AND status = 'complete'
       AND created_at >= CURRENT_DATE`,
      [userId]
    );

    return res.json({ generationCount: parseInt(result.rows[0].count), freeLimit: 2 });
  } catch (err) {
    console.error("Profile fetch error:", err);
    return res.status(500).json({ error: "Failed to fetch profile" });
  }
});

export default router;