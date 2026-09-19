# Cost Per Episode

Run date: 2026-09-19
Computed from 50 real jobs (the throughput test's loadtest run) — no new API calls made.

## Method

Chunking, retrieval, and prompt-building are deterministic, so the exact chat input each real job sent to GPT-4o-mini was reconstructed from the real persisted `chunks` rows; the real persisted `outputs.transcript` is the exact model output. Token counts use `js-tiktoken` (OpenAI's real tokenizer: o200k_base for gpt-4o-mini, cl100k_base for text-embedding-3-small) — not word-count approximations. Pricing is OpenAI's published per-token/per-character rate at time of writing.

| Component | Price | Avg. real usage (1-min episode, n=50) | Avg. real cost |
|---|---|---|---|
| Chat input (GPT-4o-mini) | $0.15/1M tokens | 754 tokens | $0.00011 |
| Chat output (GPT-4o-mini) | $0.60/1M tokens | 297 tokens | $0.00018 |
| Embeddings (text-embedding-3-small) | $0.02/1M tokens | 703 tokens | $0.00001 |
| TTS (tts-1) | $15.00/1M chars | 1533 chars | $0.02300 |
| **Total** | | | **$0.02330** |

## Measured: cost per 1-minute episode — **$0.02330**

This is the real, exact cost (given current pricing) of the 1-minute-target episodes the throughput test actually generated — not a projection.

## Projected: cost per 10-minute episode — **$0.23188**

This is a linear projection, not a new measurement: chat-input cost and embedding cost don't change with requested episode length (the retrieval context budget is fixed at 12k tokens regardless of `length`), so they're carried over unchanged. Chat-output and TTS cost scale with length (the script's target word count is `length_minutes * 150`), so they're scaled 10x. Actual GPT output length varies run to run around that target, so treat this as a reasonable estimate, not an exact figure — cite the 1-minute number as "measured" and this one as "projected" if both go on a resume.

## Not exercised by these jobs

- **Whisper transcription** ($0.006/minute of audio) only runs for video uploads without pre-extracted text — every test job pre-populated `extracted_text`, so this path was never hit. Real cost for a video-based episode would add this on top.
