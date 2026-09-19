# Async Job Throughput: Capacity Test

Run date: 2026-09-19

**This is a capacity test at `concurrency: 10` against a benchmark-only Worker spun up by this script, listening on a separate queue name ("ai-pipeline-loadtest") against local Redis. Production's `worker.ts` runs at `concurrency: 1` against the real "ai-pipeline" queue. This number describes what the architecture can sustain, not current deployed throughput.**

| Metric | Value |
|---|---|
| Jobs fired | 50 |
| Completed (first try) | 50 |
| Completed (after retry) | 0 |
| Failed (gave up after 1 retry) | 0 |
| **Failure rate** (final failures / total) | **0.0%** |
| Time to enqueue all 50 jobs | 2209ms |
| Wall-clock time for all jobs to drain | 49.8s |
| Effective throughput | 1.00 completed jobs/sec |

## Notes

- "Completed (after retry)" jobs failed once and then succeeded on the automatic retry — these do **not** count against the failure rate above. Only jobs that exhausted all attempts and were given up on count as failed.
- The queue's retry policy (`attempts: 2`) is copied from production's actual config (`lib/queue.ts`), including the fact that it has **no backoff configured** — a retry fires immediately with no delay. This is a known gap (logged separately, not fixed here): if the first failure was caused by a rate limit or transient upstream error, an immediate retry has a higher chance of hitting the same condition again than a backed-off retry would.
- Real OpenAI rate limits at the time of writing (from live `x-ratelimit-*` response headers, not the dashboard): gpt-4o-mini 10,000 RPM / 200,000 TPM, text-embedding-3-small 3,000 RPM, tts-1 500 RPM. At 10 concurrent jobs this test stays well under all three, so a meaningful failure rate here reflects the pipeline/architecture, not an API quota ceiling.
- This ran real GPT-4o-mini + TTS calls for all 50 jobs (short 1-minute-target scripts against a ~3,000-character sample), at an estimated real cost of a few cents to low tens of cents total, and wrote 50 real audio files to the production S3 bucket under a dedicated, isolated `loadtest@studysound.internal` user (same pattern as the retrieval eval's dedicated eval user).
