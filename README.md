# SmartMandarin

A continuous-acquisition Mandarin learning app: spaced-repetition vocabulary review, AI voice conversation practice, an adaptive story reader, and a system-wide popup dictionary — all backed by one FSRS-driven mastery model per word.

## Features

- **Review** — FSRS-4.5 spaced repetition on your vocabulary queue, with a separate **Slang Review** track for informal/internet Mandarin
- **Speaking Practice** — hold-to-talk voice practice, graded by Gemini
- **Conversation** — live voice chat with Gemini (Multimodal Live API over WebRTC), tap any word in the transcript to see its definition and log it as a mistake; slang-mode toggle
- **Reader** — Gemini-generated stories with per-character highlighting (known vs. queued vocabulary), click any character to queue it for review
- **My Vocabulary** — browse, search, and manage every word you've saved
- **Level Assessment** — a placement quiz to seed your starting HSK level
- Drag-to-reorder home screen — pick which learning mode leads
- English/中文 UI toggle

Home screen modes are reorderable (drag handle, persisted to `localStorage`) so you can put whichever practice mode you use most at the top.

### Popup dictionary, everywhere

The FSRS/vocabulary engine isn't limited to the app itself:

- **[Browser extension](browser-extension/)** (Chrome/Edge, Manifest V3) — select Chinese text on any webpage to get pinyin/meaning inline, queue it for review, or jump to the full word page. Authenticates with a personal access token (`Profile → Browser extension`), independent of your browser session cookie.
- **iOS Share Sheet Shortcut** — select Chinese text in any app, share it into a Shortcut that calls the same lookup API and shows the definition without leaving the app you were in.
- Both talk to `/api/extension/*`, which reuses the exact same lookup/FSRS logic (`lib/defineWord.ts`) as the in-app dictionary — one source of truth, no duplicated word data.

### Installable app

SmartMandarin is a PWA:
- **Mac**: Safari → **File → Add to Dock** for a standalone window with its own Dock icon (Sonoma+)
- **iOS**: Safari → Share → **Add to Home Screen**
- **Chrome/Edge (desktop)**: address-bar install icon, or **⋮ → Save and share → Install page as app…**; declares `capture_links` so word links opened elsewhere reuse the existing app window instead of spawning a new one

No App Store, no Apple Developer account required for any of the above.

## Stack

- **Framework**: Next.js 15 (App Router), React 19, TypeScript
- **Styling**: Tailwind CSS v4
- **Database/Auth**: Supabase (Postgres + Auth + Row-Level Security)
- **Voice**: Gemini Multimodal Live API (WebRTC) for conversation practice, ElevenLabs Scribe for speech-to-text
- **Text generation/grading**: Gemini Flash (`gemini-3.1-flash-lite`) for story generation, answer/sentence grading, and AI dictionary fallback
- **Dictionary data**: CC-CEDICT (bundled + Supabase-seeded), HSK vocabulary lists, a hand-curated slang bank
- **Drag & drop**: `@dnd-kit`

## Project structure

```
app/
  _components/        Shared client components (home screen, nav, language context)
  actions/             Server actions — getDueWords, submitReview, logMistake, addWord(s)
  api/                 Route handlers: converse, transcribe, grade-answer, grade-sentence,
                        generate-story, define-word, gemini-token, search-words, extension/*
  review/              FSRS review session + slang review
  conversation/        Voice chat UI + transcript
  reader/              Story generator + interactive reading view
  speaking/            Hold-to-talk practice
  assessment/          HSK level placement quiz
  vocab/                Vocabulary browser + per-word detail page
  settings/extension/  Manage browser-extension access tokens
  profile/             Account settings, sign out
  manifest.ts          PWA manifest (icons, capture_links, theme)
lib/
  fsrs.ts              FSRS-4.5 scheduling algorithm + HSK injection logic
  defineWord.ts         Shared dictionary-lookup core (used by both /api/define-word and
                        /api/extension/lookup)
  cedict.ts, segment.ts CC-CEDICT lookup + Chinese word segmentation
  extensionAuth.ts      Bearer-token auth for the browser extension / external clients
  supabase/             Browser + server Supabase clients, hand-authored DB types
browser-extension/      Chrome/Edge MV3 popup dictionary (see its own README)
supabase/migrations/    Full schema history (vocabulary_mastery, review_log, slang_bank,
                        cedict, extension_tokens, RLS policies, RPCs)
scripts/                Data pipeline: CEDICT DB build, HSK/slang seeding, Popcidian scraping
```

## Getting started

**Prerequisites**: Node.js 20+, a Supabase project, a Gemini API key, an ElevenLabs API key.

```bash
npm install
cp .env.example .env.local   # fill in the values below
npm run dev
```

### Environment variables (`.env.local`)

| Variable | Used for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (browser client) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase client (extension API routes, seeding scripts) |
| `GEMINI_API_KEY` | Story generation, conversation, grading, AI dictionary fallback |
| `ELEVENLABS_API_KEY` | Speech-to-text for Speaking Practice |
| `NEXT_PUBLIC_APP_URL` | Base URL used in generated links (browser extension "open full page", etc.) |

### Database

Apply `supabase/migrations/*.sql` in order (Supabase CLI or the SQL editor). Seed dictionary data with:

```bash
npm run build-cedict-db        # builds local CEDICT sqlite db from data/cedict.txt
node scripts/seed-cedict-supabase.mjs
node scripts/import-slang.mjs
```

### Other scripts

- `npm run type-check` — TypeScript, no emit
- `npm run build` / `npm run start` — production build/serve

## Status

Actively developed. Auth, FSRS review, conversation practice, the story reader, the browser extension, and the PWA install path are all built and working. Not yet built: a LangGraph-based stateful tutoring layer, automated CI, and native (Capacitor/Swift) app builds — the current install story is PWA-only, which covers Mac/iOS/desktop-Chrome installability but not App Store distribution or iOS Universal Links (both gated behind a paid Apple Developer account, deliberately deferred).
