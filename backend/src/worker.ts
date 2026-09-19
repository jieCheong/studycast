import { initSentry, Sentry } from "./lib/sentry";
initSentry();

import { Worker, Job } from "bullmq";
import { redisConnection } from "./lib/redis";
import { PipelineJobData } from "./lib/queue";
import { runPipelineJob } from "./lib/pipeline";
import { logger } from "./lib/logger";

const worker = new Worker<PipelineJobData>(
  "ai-pipeline",
  async (job: Job<PipelineJobData>) => {
    try {
      return await runPipelineJob(job.data, (step, percent) => job.updateProgress({ step, percent }));
    } catch (err: unknown) {
      Sentry.captureException(err, {
        extra: { jobId: job.data.jobId, uploadId: job.data.uploadId, userId: job.data.userId },
      });
      throw err; // re-throw so BullMQ marks it as failed and can retry
    }
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { connection: redisConnection as any, concurrency: 1 } // temporarily reduced to 1 during quota recovery
);

worker.on("completed", (job) => {
  logger.info({ jobId: job.id }, "Job completed");
});

worker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, "Job failed");
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
  Sentry.captureException(reason);
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception");
  Sentry.captureException(err);
});

logger.info("Worker started, listening for jobs");
