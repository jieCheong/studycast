
# StudyCast AI — End-to-End Slice

## What We're Building
A focused first version: upload a PDF → AI structures & generates an audio script → ElevenLabs converts to speech → play/download in-browser. Includes auth and one mode/language/voice option.

## Pages & Flow

### 1. Landing Page
- Hero with tagline: "Turn your study materials into podcast-style audio"
- CTA → Sign up or log in
- Brief "How it works" section (3 steps: Upload → Customize → Listen)

### 2. Auth (Login / Sign Up)
- Email + password via Supabase Auth
- Profile table for storing generation count and plan info
- Password reset flow with `/reset-password` page

### 3. Upload & Configure Page (main app screen, behind auth)
- PDF drag-and-drop upload (max 20 pages for MVP, ~10MB limit)
- Configuration panel:
  - **Study Mode**: Memorization / Understanding
  - **Language**: English / Korean
  - **Length**: 5 / 10 / 15 / 30 min
  - **Voice**: Lecture / Podcast / Calm / Energetic (mapped to ElevenLabs voices)
- "Generate" button → kicks off processing

### 4. Processing / Status View
- Progress indicator with steps: Extracting → Structuring → Generating Script → Creating Audio
- Async job polling

### 5. Results Page
- Audio player (in-browser playback)
- Transcript/script view below player
- Download MP3 button
- "Generate Another" button

## Backend (Lovable Cloud + Edge Functions)

### Database Tables
- `profiles` — user_id, generation_count, created_at
- `uploads` — id, user_id, filename, extracted_text, created_at
- `jobs` — id, upload_id, mode, language, length, voice, status (queued/processing/complete/failed), error_message, created_at, completed_at
- `outputs` — id, job_id, transcript, audio_url, duration_seconds

### Edge Functions
1. **`process-pdf`** — Receives uploaded PDF, extracts text using pdf-parse, cleans it, saves to `uploads` table
2. **`generate-script`** — Takes extracted text + settings, calls OpenAI API to structure content and generate an audio script (with mode/language/length-specific prompts), saves transcript
3. **`generate-audio`** — Takes the script, calls ElevenLabs TTS API, stores MP3 in Supabase Storage, updates job status
4. **`job-status`** — Returns current job status for polling

### Storage
- Supabase Storage bucket `audio-files` for generated MP3s
- Supabase Storage bucket `pdf-uploads` for uploaded PDFs

## Key Technical Details
- OpenAI API key stored as a Supabase secret (user provides their own key)
- ElevenLabs API key stored as a Supabase secret (user provides their own key, or we use the ElevenLabs connector)
- PDF text extraction done server-side in edge function
- Script generation uses carefully crafted prompts for memorization vs understanding modes
- Voice mapping: 4 ElevenLabs voice IDs for different styles (e.g., Brian for lecture, Sarah for calm)
- Free tier: 3 generations tracked via `profiles.generation_count`

## Design
- Clean, modern UI with shadcn/ui components
- Mobile-friendly responsive layout
- Progress animations during generation
- Accessible audio player with standard controls
