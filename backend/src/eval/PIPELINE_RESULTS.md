# Pipeline Latency: Sync vs. Async Decoupling

Run date: 2026-09-19

Same sample document, same job parameters (mode=understanding, 1-minute target script, voice=alloy), run through the exact same pipeline code (`runPipelineJob` in `lib/pipeline.ts`) two ways: called directly in-process (blocking) vs. enqueued through the real BullMQ queue and picked up by the actual `worker.ts` process (async) — both against a local Postgres + Redis stack.

| Metric | Time |
|---|---|
| Blocking: full pipeline run inline | 11751ms |
| Async: time to acknowledge (enqueue) | 9ms |
| Async: total time to completion | 9454ms |

## Two different claims, not one

**Perceived response latency reduction: 99.9%.** This compares the blocking pipeline's full duration to how long a client actually waits for a response under the real architecture (`POST /jobs` returns 202 as soon as the job is enqueued, before any AI work happens). This number is large by construction — decoupling wins here almost for free. Cite it as "time to acknowledgment," not as a general pipeline speedup.

**Total completion time delta: -19.5%.** This compares actual total work time under each architecture — same steps, same APIs, just blocking vs. queued. This is the honest "does async add overhead" number; it should sit close to 0%, since the worker isn't currently parallelizing any pipeline stages, just moving the same sequential work off the request thread.

Note: this ran a 1-minute-target script against a ~3,000-character sample document to keep OpenAI cost and run time low. Absolute times will be larger for full-length documents/scripts, but the *shape* of the comparison (huge perceived-latency win, ~flat total processing time) should hold.
