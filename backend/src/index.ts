import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { pool } from "./db";
import authRouter from "./routes/auth";
import { requireAuth, AuthRequest } from "./middleware/auth";
import uploadRouter from "./routes/upload";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get("/health", (req: Request, res: Response) => {
    res.json({ status: "ok" });
});

app.get("/health-db", async (req: Request, res: Response) => {
    try {
        const result = await pool.query("SELECT NOW()");
        res.json({status: "ok", dbTime: result.rows[0].now});
    } catch (err) {
        console.error("DB health check failed:", err);
        res.status(500).json({status:"error", message: "Database connection failed"});
    }
});

app.use("/api/auth", authRouter);
app.use("/api/upload", uploadRouter);

app.get("/api/me", requireAuth, (req: AuthRequest, res) => {
  res.json({ userId: req.userId });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});