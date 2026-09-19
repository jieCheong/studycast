// The benchmark-only queue/worker below always run against local Redis, never production —
// see PIPELINE_RESULTS.md for why (production Redis is Railway-internal and a real deployed
// worker already consumes the real "ai-pipeline" queue name there). DATABASE_URL is left at
// its default (production Neon), matching the retrieval eval's pattern: real rows, isolated
// under a dedicated loadtest user, never touching real user data.
process.env.REDIS_URL = "redis://localhost:6379";

import fs from "fs";
import path from "path";
import { performance } from "perf_hooks";
import { Queue, Worker, Job } from "bullmq";
import { pool } from "../db";
import { redisConnection } from "../lib/redis";
import { runPipelineJob } from "../lib/pipeline";
import { PipelineJobData } from "../lib/queue";

const QUEUE_NAME = "ai-pipeline-loadtest"; // distinct from production's "ai-pipeline" — a second
// guardrail against ever colliding with the real deployed worker, even though local vs.
// production Redis already makes that physically impossible.
const CONCURRENCY = 10; // capacity test only — production's worker.ts runs at concurrency: 1
const JOB_COUNT = 50;
const MAX_ATTEMPTS = 2; // matches production's lib/queue.ts defaultJobOptions.attempts
const LOADTEST_USER_EMAIL = "loadtest@studysound.internal";
const RESULTS_PATH = path.join(__dirname, "THROUGHPUT_RESULTS.md");
const DRAIN_TIMEOUT_MS = 10 * 60 * 1000;

// Short/cheap sample, same rationale as pipeline-latency.ts: this benchmarks the queue's
// ability to sustain concurrent pressure, not how the pipeline scales with document size.
const SAMPLE_TEXT = fs.readFileSync(path.join(__dirname, "corpus", "algorithms.txt"), "utf-8").slice(0, 3000);
const JOB_PARAMS = { mode: "understanding", language: "English", length: "1", voice: "alloy" };

type Outcome = "success-first-try" | "success-retry" | "failed-final" | "timed-out";

interface JobTrace {
  enqueueMs: number;
  finishMs?: number;
  outcome?: Outcome;
  attemptsMade?: number;
}

async function getOrCreateLoadtestUser(): Promise<string> {
  const existing = await pool.query("SELECT id FROM users WHERE email = $1", [LOADTEST_USER_EMAIL]);
  if (existing.rows.length > 0) return existing.rows[0].id;

  const inserted = await pool.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
    [LOADTEST_USER_EMAIL, "loadtest-account-not-a-real-login"]
  );
  return inserted.rows[0].id;
}

async function seedUploads(userId: string, n: number): Promise<string[]> {
  const runTag = Date.now();
  const uploadIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const inserted = await pool.query(
      "INSERT INTO uploads (user_id, filename, extracted_text) VALUES ($1, $2, $3) RETURNING id",
      [userId, `loadtest-${runTag}-${i}.txt`, SAMPLE_TEXT]
    );
    uploadIds.push(inserted.rows[0].id);
  }
  return uploadIds;
}

async function createJobRow(uploadId: string, userId: string): Promise<string> {
  const inserted = await pool.query(
    `INSERT INTO jobs (upload_id, user_id, mode, language, length, voice, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'queued') RETURNING id`,
    [uploadId, userId, JOB_PARAMS.mode, JOB_PARAMS.language, JOB_PARAMS.length, JOB_PARAMS.voice]
  );
  return inserted.rows[0].id;
}

function writeResults(
  traces: Map<string, JobTrace>,
  enqueueWallMs: number,
  drainWallMs: number
): void {
  const all = [...traces.values()];
  const successFirstTry = all.filter((t) => t.outcome === "success-first-try").length;
  const successRetry = all.filter((t) => t.outcome === "success-retry").length;
  const failedFinal = all.filter((t) => t.outcome === "failed-final").length;
  const timedOut = all.filter((t) => t.outcome === "timed-out" || !t.outcome).length;
  const completed = successFirstTry + successRetry;
  const failureRatePct = (failedFinal / all.length) * 100;

  const lines = [
    "# Async Job Throughput: Capacity Test",
    "",
    `Run date: ${new Date().toISOString().slice(0, 10)}`,
    "",
    `**This is a capacity test at \`concurrency: ${CONCURRENCY}\` against a benchmark-only Worker ` +
      `spun up by this script, listening on a separate queue name ("${QUEUE_NAME}") against local Redis. ` +
      "Production's `worker.ts` runs at `concurrency: 1` against the real \"ai-pipeline\" queue. " +
      "This number describes what the architecture can sustain, not current deployed throughput.**",
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Jobs fired | ${all.length} |`,
    `| Completed (first try) | ${successFirstTry} |`,
    `| Completed (after retry) | ${successRetry} |`,
    `| Failed (gave up after ${MAX_ATTEMPTS - 1} retr${MAX_ATTEMPTS - 1 === 1 ? "y" : "ies"}) | ${failedFinal} |`,
    ...(timedOut > 0 ? [`| Never settled (script timeout) | ${timedOut} |`] : []),
    `| **Failure rate** (final failures / total) | **${failureRatePct.toFixed(1)}%** |`,
    `| Time to enqueue all ${all.length} jobs | ${enqueueWallMs.toFixed(0)}ms |`,
    `| Wall-clock time for all jobs to drain | ${(drainWallMs / 1000).toFixed(1)}s |`,
    `| Effective throughput | ${(completed / (drainWallMs / 1000)).toFixed(2)} completed jobs/sec |`,
    "",
    "## Notes",
    "",
    "- \"Completed (after retry)\" jobs failed once and then succeeded on the automatic retry — " +
      "these do **not** count against the failure rate above. Only jobs that exhausted all attempts " +
      "and were given up on count as failed.",
    "- The queue's retry policy (`attempts: 2`) is copied from production's actual config " +
      "(`lib/queue.ts`), including the fact that it has **no backoff configured** — a retry fires " +
      "immediately with no delay. This is a known gap (logged separately, not fixed here): if the " +
      "first failure was caused by a rate limit or transient upstream error, an immediate retry has " +
      "a higher chance of hitting the same condition again than a backed-off retry would.",
    "- Real OpenAI rate limits at the time of writing (from live `x-ratelimit-*` response headers, " +
      "not the dashboard): gpt-4o-mini 10,000 RPM / 200,000 TPM, text-embedding-3-small 3,000 RPM, " +
      `tts-1 500 RPM. At ${CONCURRENCY} concurrent jobs this test stays well under all three, so a ` +
      "meaningful failure rate here reflects the pipeline/architecture, not an API quota ceiling.",
    "- This ran real GPT-4o-mini + TTS calls for all 50 jobs (short 1-minute-target scripts against a " +
      "~3,000-character sample), at an estimated real cost of a few cents to low tens of cents total, " +
      "and wrote 50 real audio files to the production S3 bucket under a dedicated, isolated " +
      `\`${LOADTEST_USER_EMAIL}\` user (same pattern as the retrieval eval's dedicated eval user).`,
    "",
  ];
  fs.writeFileSync(RESULTS_PATH, lines.join("\n"));
  console.log(`\nResults written to ${RESULTS_PATH}`);
}

async function main() {
  const userId = await getOrCreateLoadtestUser();

  console.log(`Seeding ${JOB_COUNT} upload rows...`);
  const uploadIds = await seedUploads(userId, JOB_COUNT);

  const loadtestQueue = new Queue<PipelineJobData>(QUEUE_NAME, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connection: redisConnection as any,
    defaultJobOptions: { attempts: MAX_ATTEMPTS }, // matches production's current retry policy (no backoff — see notes)
  });

  const traces = new Map<string, JobTrace>();
  let settledCount = 0;
  let resolveAllDone: () => void = () => {};
  const allDone = new Promise<void>((resolve) => {
    resolveAllDone = resolve;
  });

  const worker = new Worker<PipelineJobData>(
    QUEUE_NAME,
    (job: Job<PipelineJobData>) => runPipelineJob(job.data),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { connection: redisConnection as any, concurrency: CONCURRENCY }
  );

  worker.on("completed", (job) => {
    const trace = traces.get(job.data.jobId);
    if (!trace) return;
    trace.finishMs = performance.now();
    trace.attemptsMade = job.attemptsMade;
    trace.outcome = job.attemptsMade > 1 ? "success-retry" : "success-first-try";
    settledCount++;
    if (settledCount === JOB_COUNT) resolveAllDone();
  });

  worker.on("failed", (job, err) => {
    if (!job) return;
    const trace = traces.get(job.data.jobId);
    if (!trace) return;

    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) {
      console.log(`  job ${job.data.jobId} failed attempt ${job.attemptsMade}, will retry: ${err.message}`);
      return; // BullMQ will retry this automatically — not a final failure yet
    }

    trace.finishMs = performance.now();
    trace.attemptsMade = job.attemptsMade;
    trace.outcome = "failed-final";
    settledCount++;
    if (settledCount === JOB_COUNT) resolveAllDone();
  });

  console.log(`Creating ${JOB_COUNT} job rows and firing them onto "${QUEUE_NAME}" (concurrency: ${CONCURRENCY})...`);
  const enqueueStart = performance.now();
  for (const uploadId of uploadIds) {
    const jobId = await createJobRow(uploadId, userId);
    traces.set(jobId, { enqueueMs: performance.now() });
    await loadtestQueue.add("process-pipeline", { jobId, uploadId, userId, ...JOB_PARAMS });
  }
  const enqueueWallMs = performance.now() - enqueueStart;
  console.log(`All ${JOB_COUNT} jobs enqueued in ${enqueueWallMs.toFixed(0)}ms. Waiting for drain...`);

  const drainStart = performance.now();
  const timeout = new Promise<void>((_, reject) =>
    setTimeout(() => reject(new Error("drain-timeout")), DRAIN_TIMEOUT_MS)
  );
  try {
    await Promise.race([allDone, timeout]);
  } catch {
    console.warn(`Timed out after ${DRAIN_TIMEOUT_MS / 1000}s waiting for all jobs to settle — reporting partial results.`);
    for (const trace of traces.values()) {
      if (!trace.outcome) trace.outcome = "timed-out";
    }
  }
  const drainWallMs = performance.now() - drainStart;

  await worker.close();
  await loadtestQueue.close();

  writeResults(traces, enqueueWallMs, drainWallMs);

  await pool.end();
  redisConnection.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
