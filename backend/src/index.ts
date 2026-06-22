import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { pool } from "./db";
import authRouter from "./routes/auth";
import { requireAuth, AuthRequest } from "./middleware/auth";
import uploadRouter from "./routes/upload";
import extractRouter from "./routes/extract";
import youtubeRouter from "./routes/youtube";
import historyRouter from "./routes/history";
import profileRouter from "./routes/profile";
import jobsRouter from "./routes/jobs";
import { logger } from "./lib/logger";
import pinoHttp from "pino-http";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());
app.use(pinoHttp({ logger }));

app.get("/health", (req: Request, res: Response) => {
    res.json({ status: "ok" });
});

app.get("/health-db", async (req: Request, res: Response) => {
    try {
        const result = await pool.query("SELECT NOW()");
        res.json({status: "ok", dbTime: result.rows[0].now});
    } catch (err) {
        logger.error({ err }, "DB health check failed");
        res.status(500).json({status:"error", message: "Database connection failed"});
    }
});

app.use("/api/auth", authRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/extract", extractRouter);
app.use("/api/youtube", youtubeRouter);
app.use("/api/history", historyRouter);
app.use("/api/profile", profileRouter);
app.use("/api/jobs", jobsRouter);

app.get("/api/me", requireAuth, (req: AuthRequest, res) => {
  res.json({ userId: req.userId });
});

app.listen(PORT, () => {
    logger.info(`Server running on http://localhost:${PORT}`);
});