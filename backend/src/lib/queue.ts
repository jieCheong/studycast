import { Queue } from "bullmq";
import { redisConnection } from "./redis";

export interface PipelineJobData {
  jobId: string; // your existing Postgres jobs.id, not BullMQ's internal id
  uploadId: string;
  userId: string;
  mode: string;
  language: string;
  length: string;
  voice?: string;
}

export const pipelineQueue = new Queue<PipelineJobData, any, string>("ai-pipeline", {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 2, // retry once on failure
    removeOnComplete: { age: 3600 }, // clean up completed jobs after 1hr
    removeOnFail: { age: 86400 }, // keep failed jobs for 24hr for debugging
  },
});