// Points DB/queue connections at the local docker-compose Postgres+Redis instead of
// production, before any module that reads these env vars at import time gets loaded.
process.env.DATABASE_URL = "postgresql://studycast:localdevpassword@localhost:5432/studycast";
process.env.REDIS_URL = "redis://localhost:6379";

import fs from "fs";
import path from "path";
import { performance } from "perf_hooks";
import { pool } from "../db";
import { pipelineQueue } from "../lib/queue";
import { runPipelineJob } from "../lib/pipeline";
import { redisConnection } from "../lib/redis";

const RESULTS_PATH = path.join(__dirname, "PIPELINE_RESULTS.md");
const LOCAL_USER_EMAIL = "pipeline-bench@studysound.local";

// A short sample keeps OpenAI cost/run time low — this benchmarks the architecture
// (blocking vs. queued), not how the pipeline scales with document size.
const SAMPLE_TEXT = fs.readFileSync(path.join(__dirname, "corpus", "algorithms.txt"), "utf-8").slice(0, 3000);

const JOB_PARAMS = { mode: "understanding", language: "English", length: "1", voice: "alloy" };

async function getOrCreateLocalUser(): Promise<string> {
  const existing = await pool.query("SELECT id FROM users WHERE email = $1", [LOCAL_USER_EMAIL]);
  if (existing.rows.length > 0) return existing.rows[0].id;

  const inserted = await pool.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
    [LOCAL_USER_EMAIL, "local-benchmark-not-a-real-login"]
  );
  return inserted.rows[0].id;
}

async function createUpload(userId: string, label: string): Promise<string> {
  const inserted = await pool.query(
    "INSERT INTO uploads (user_id, filename, extracted_text) VALUES ($1, $2, $3) RETURNING id",
    [userId, `pipeline-bench-${label}-${Date.now()}.txt`, SAMPLE_TEXT]
  );
  return inserted.rows[0].id;
}

async function createJobRow(uploadId: string, userId: string): Promise<string> {
  const inserted = await pool.query(
    `INSERT INTO jobs (upload_id, user_id, mode, language, length, voice, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'queued') RETURNING id`,
    [uploadId, userId, JOB_PARAMS.mode, JOB_PARAMS.language, JOB_PARAMS.length, JOB_PARAMS.voice]
  );
  return inserted.rows[0].id;
}

async function pollJobStatus(jobId: string, intervalMs = 400, timeoutMs = 180000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await pool.query("SELECT status FROM jobs WHERE id = $1", [jobId]);
    const status = result.rows[0]?.status;
    if (status === "complete" || status === "failed") return status;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for job ${jobId} to complete`);
}

async function runBlocking(userId: string): Promise<number> {
  const uploadId = await createUpload(userId, "blocking");
  const jobId = await createJobRow(uploadId, userId);

  const start = performance.now();
  await runPipelineJob({ jobId, uploadId, userId, ...JOB_PARAMS });
  return performance.now() - start;
}

async function runAsync(userId: string): Promise<{ enqueueMs: number; totalMs: number }> {
  const uploadId = await createUpload(userId, "async");

  const start = performance.now();
  const jobId = await createJobRow(uploadId, userId);
  await pipelineQueue.add("process-pipeline", { jobId, uploadId, userId, ...JOB_PARAMS });
  const enqueueMs = performance.now() - start;

  const status = await pollJobStatus(jobId);
  const totalMs = performance.now() - start;
  if (status === "failed") throw new Error(`Async job ${jobId} failed — check local worker logs`);

  return { enqueueMs, totalMs };
}

function writeResults(d: {
  blockingMs: number;
  enqueueMs: number;
  asyncMs: number;
  perceivedReductionPct: number;
  totalTimeDeltaPct: number;
}): void {
  const lines = [
    "# Pipeline Latency: Sync vs. Async Decoupling",
    "",
    `Run date: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "Same sample document, same job parameters (mode=understanding, 1-minute target script, voice=alloy), " +
      "run through the exact same pipeline code (`runPipelineJob` in `lib/pipeline.ts`) two ways: called " +
      "directly in-process (blocking) vs. enqueued through the real BullMQ queue and picked up by the actual " +
      "`worker.ts` process (async) — both against a local Postgres + Redis stack.",
    "",
    "| Metric | Time |",
    "|---|---|",
    `| Blocking: full pipeline run inline | ${d.blockingMs.toFixed(0)}ms |`,
    `| Async: time to acknowledge (enqueue) | ${d.enqueueMs.toFixed(0)}ms |`,
    `| Async: total time to completion | ${d.asyncMs.toFixed(0)}ms |`,
    "",
    "## Two different claims, not one",
    "",
    `**Perceived response latency reduction: ${d.perceivedReductionPct.toFixed(1)}%.** This compares the blocking ` +
      "pipeline's full duration to how long a client actually waits for a response under the real architecture " +
      "(`POST /jobs` returns 202 as soon as the job is enqueued, before any AI work happens). This number is " +
      "large by construction — decoupling wins here almost for free. Cite it as \"time to acknowledgment,\" not " +
      "as a general pipeline speedup.",
    "",
    `**Total completion time delta: ${d.totalTimeDeltaPct >= 0 ? "+" : ""}${d.totalTimeDeltaPct.toFixed(1)}%.** This ` +
      "compares actual total work time under each architecture — same steps, same APIs, just blocking vs. queued. " +
      "This is the honest \"does async add overhead\" number; it should sit close to 0%, since the worker isn't " +
      "currently parallelizing any pipeline stages, just moving the same sequential work off the request thread.",
    "",
    "Note: this ran a 1-minute-target script against a ~3,000-character sample document to keep OpenAI cost and " +
      "run time low. Absolute times will be larger for full-length documents/scripts, but the *shape* of the " +
      "comparison (huge perceived-latency win, ~flat total processing time) should hold.",
    "",
  ];
  fs.writeFileSync(RESULTS_PATH, lines.join("\n"));
  console.log(`\nResults written to ${RESULTS_PATH}`);
}

async function main() {
  const userId = await getOrCreateLocalUser();

  console.log("Running blocking pipeline (in-process, no queue)...");
  const blockingMs = await runBlocking(userId);
  console.log(`Blocking total: ${blockingMs.toFixed(0)}ms`);

  console.log("\nRunning async pipeline (enqueued, processed by local worker container)...");
  const { enqueueMs, totalMs: asyncMs } = await runAsync(userId);
  console.log(`Async enqueue (perceived response time): ${enqueueMs.toFixed(0)}ms`);
  console.log(`Async total completion time: ${asyncMs.toFixed(0)}ms`);

  const perceivedReductionPct = ((blockingMs - enqueueMs) / blockingMs) * 100;
  const totalTimeDeltaPct = ((asyncMs - blockingMs) / blockingMs) * 100;

  console.log(`\nPerceived response latency reduction: ${perceivedReductionPct.toFixed(1)}%`);
  console.log(
    `Total completion time delta (async vs blocking): ${totalTimeDeltaPct >= 0 ? "+" : ""}${totalTimeDeltaPct.toFixed(1)}%`
  );

  writeResults({ blockingMs, enqueueMs, asyncMs, perceivedReductionPct, totalTimeDeltaPct });

  await pool.end();
  await pipelineQueue.close();
  // `pipelineQueue.close()` doesn't disconnect `redisConnection` since we own that
  // connection's lifecycle (it's shared, not queue-owned) — close it explicitly, or
  // this one-shot script hangs forever on ioredis's keepalive/retry timers.
  redisConnection.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
