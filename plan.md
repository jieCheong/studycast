# StudyCast AI — Project Plan

## What it does
Converts study materials (PDF, PPTX, DOCX, or YouTube videos) into AI-generated audio summaries. Users upload a file or paste a YouTube URL, choose a voice style and script mode, and receive a downloadable audio file.

---

## Tech Stack

### Frontend
| Layer | Choice |
|---|---|
| Framework | React 18 + TypeScript |
| Build tool | Vite 5 (SWC) |
| Routing | React Router v6 |
| Server state | TanStack Query v5 |
| Styling | Tailwind CSS v3 |
| Component library | shadcn/ui (Radix UI primitives) |
| Animations | Framer Motion |
| Forms | React Hook Form + Zod |
| Icons | Lucide React |
| Unit tests | Vitest + Testing Library |

### Backend
| Layer | Choice |
|---|---|
| Runtime | Node.js + Express v5 |
| Language | TypeScript (ts-node, nodemon) |
| Database | PostgreSQL (pg driver) |
| Migrations | node-pg-migrate |
| Auth | JWT (jsonwebtoken) + bcrypt |
| File handling | Multer |

### Cloud & Storage
| Service | Purpose |
|---|---|
| AWS S3 | Uploaded file storage + generated audio storage |
| AWS S3 Presigned URLs | Secure, time-limited audio download links |

### AI Services
| Service | Purpose |
|---|---|
| Google Gemini | Text extraction from PDF / PPTX / DOCX |
| OpenAI GPT-4o-mini | Script generation (standard + spaced-repetition mode) |
| OpenAI TTS | Audio generation (voices: onyx, echo, shimmer, nova) |
| ElevenLabs | Alternative audio generation |
| youtube-transcript | YouTube transcript fetching |

---

## Database Schema

| Table | Purpose |
|---|---|
| `users` | Email + hashed password |
| `profiles` | Display name, usage counters |
| `uploads` | File metadata, S3 key, source type (file/youtube) |
| `jobs` | Processing status per upload |
| `outputs` | Generated audio S3 key + presigned URL |
| `reset_tokens` | Password reset flow |

---

## API Routes

| Method | Route | Description |
|---|---|---|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login, returns JWT |
| POST | `/api/upload` | Upload file (PDF/PPTX/DOCX) to S3 |
| POST | `/api/extract` | Extract text via Gemini |
| POST | `/api/youtube` | Fetch YouTube transcript |
| POST | `/api/generate-script` | Generate study script via GPT-4o-mini |
| POST | `/api/generate-audio` | Generate audio via OpenAI TTS / ElevenLabs, store to S3 |

---

## Features Built

- [x] JWT auth with password reset
- [x] File upload (PDF, PPTX, DOCX, PPT, DOC) → S3
- [x] Text extraction via Gemini
- [x] YouTube transcript fetching
- [x] Script generation with spaced-repetition memorization mode
- [x] Audio generation (OpenAI TTS) → S3 → presigned URL
- [x] Dashboard: file/YouTube tabs, voice selector, progress bar, recent history
- [x] Free tier limit (3 generations)

## Planned / In Progress

- [ ] ElevenLabs voice integration (key is set, route needs wiring)
- [ ] Job status polling (current flow is synchronous)
- [ ] User profile page
- [ ] Stripe / payment for paid tier
- [ ] Deploy (frontend: Vercel/Netlify, backend: Railway/Render)
