
# StudyCast AI — End-to-End Slice

## What We're Building
A focused first version: upload a PDF, PPTX, DOCX, or paste a YouTube link → AI structures & generates an audio script → OpenAI TTS converts it to speech → play/download in-browser. Includes custom auth and configurable mode/language/voice/length options.

## Pages & Flow

### 1. Landing Page
- Hero with tagline: "Turn your study materials into podcast-style audio"
- CTA → Sign up or log in
- Brief "How it works" section (3 steps: Upload → Customize → Listen)

### 2. Auth (Login / Sign Up)
- Email + password, fully custom-built — no third-party auth provider
- Passwords hashed with bcrypt (10 salt rounds)
- JWT-based sessions (7-day expiry), verified via Express middleware
- `profiles` table for storing generation count, auto-created on signup
- Password reset flow via single-use, time-limited tokens (`/reset-password?token=...`)

### 3. Upload & Configure Page (main app screen, behind auth)
- File drag-and-drop upload: PDF, PPTX, DOCX (max 10MB)
- YouTube URL input as an alternative source (toggle/tab between file and link)
- Configuration panel:
  - **Study Mode**: Memorization / Understanding
  - **Language**: English / Korean
  - **Length**: 5 / 10 / 15 / 30 min
  - **Voice**: Lecture / Podcast / Calm / Energetic (mapped to OpenAI TTS voices: onyx, echo, shimmer, nova)
- "Generate" button → kicks off the full pipeline sequentially (upload → extract → script → audio)

### 4. Processing / Status View
- Progress indicator with steps: Uploading → Extracting → Generating Script → Creating Audio
- Sequential async calls to own Express API (no polling needed — each step awaits the previous and updates UI state directly)

### 5. Results Page
- Audio player (in-browser playback) backed by a presigned S3 URL
- Transcript/script view below player, showing the full 3-part memorization structure when applicable
- Download MP3 button
- "Generate Another" button

## Backend (Custom Express API + PostgreSQL)

### Database Tables (PostgreSQL, managed via node-pg-migrate)
- `users` — id, email, password_hash, created_at
- `profiles` — user_id, generation_count, created_at, updated_at
- `uploads` — id, user_id, filename, file_path, extracted_text, created_at
- `jobs` — id, upload_id, user_id, mode, language, length, voice, status (queued/processing/complete/failed), error_message, created_at, completed_at
- `outputs` — id, job_id, transcript, audio_url, duration_seconds, created_at
- `reset_tokens` — id, user_id, token, expires_at, created_at

### API Routes (Express, all protected routes verify JWT + ownership)
1. **`POST /api/auth/signup`** — bcrypt-hashes password, creates user + profile
2. **`POST /api/auth/login`** — verifies credentials, issues JWT
3. **`POST /api/auth/forgot-password`** / **`POST /api/auth/reset-password`** — single-use token reset flow
4. **`POST /api/upload`** — accepts PDF/PPTX/DOCX via multer, stores in S3, creates `uploads` row
5. **`POST /api/extract`** — downloads file from S3, sends to Gemini (1.5 Flash) for text extraction, saves to `uploads.extracted_text`
6. **`POST /api/youtube`** — fetches video transcript via `youtube-transcript`, saves directly to `uploads` (same shape as a file-based upload)
7. **`POST /api/generate-script`** — sends extracted text + settings to GPT-4o-mini using mode-specific prompts (spaced-repetition 3-part structure for memorization mode), saves transcript to `outputs`
8. **`POST /api/generate-audio`** — chunks transcript (4096-char limit), calls OpenAI TTS per chunk, stitches MP3, uploads to S3, returns a 7-day presigned URL, increments `profiles.generation_count`

### Storage
- AWS S3 bucket, private (no public access), organized as:
  - `{userId}/{timestamp}_{filename}` for uploaded source files
  - `audio/{jobId}.mp3` for generated audio
- All file access via presigned URLs (generated on demand), never public links

## Key Technical Details
- OpenAI API key stored as a backend environment variable (developer-provided, not user-provided)
- Gemini API key (free tier) used for PDF/PPTX/DOCX text extraction
- No ElevenLabs — switched to OpenAI TTS (`tts-1`) to stay within free/low-cost usage during development
- Text extraction handled server-side via Gemini's multimodal file input (base64 inline)
- Script generation uses mode-specific system prompts: memorization mode enforces a strict 3-part structure (preview → explanation → rapid recall recap) to mirror how people passively memorize song lyrics through repetition
- Voice mapping: 4 OpenAI TTS voices mapped to UI labels (lecture → onyx, podcast → echo, calm → shimmer, energetic → nova)
- Free tier: 3 generations tracked via `profiles.generation_count`, enforced server-side
- Ownership enforced at the application layer on every protected route (`WHERE user_id = $1`), since there's no database-level RLS — this is intentional, to deeply understand authorization logic rather than relying on a managed policy engine

## Design
- Clean, modern UI with shadcn/ui components and Framer Motion transitions
- Mobile-friendly responsive layout
- Progress animations during generation
- Accessible audio player with standard controls and adjustable playback speed