import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { pool } from "./db";
import authRouter from "./routes/auth";
import { requireAuth, AuthRequest } from "./middleware/auth";
import uploadRouter from "./routes/upload";
import extractRouter from "./routes/extract";
import youtubeRouter from "./routes/youtube";
import generateScriptRouter from "./routes/generateScript";
import generateAudioRouter from "./routes/generateAudio";
import historyRouter from "./routes/history";
import profileRouter from "./routes/profile";

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
app.use("/api/extract", extractRouter);
app.use("/api/youtube", youtubeRouter);
app.use("/api/generate-script", generateScriptRouter);
app.use("/api/generate-audio", generateAudioRouter);
app.use("/api/history", historyRouter);
app.use("/api/profile", profileRouter);

app.get("/api/me", requireAuth, (req: AuthRequest, res) => {
  res.json({ userId: req.userId });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});