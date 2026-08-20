# SmartMandarin

A continuous-acquisition Mandarin learning app: spaced-repetition vocabulary review, AI voice conversation practice, an adaptive story reader, and a system-wide popup dictionary — all backed by one FSRS-driven mastery model per word.

## Features

- **Daily** — a curated daily batch of words to learn, quizzed the next day (with carry-over for anything missed), tracked on a home-screen streak calendar
- **Review** — FSRS-4.5 spaced repetition on your vocabulary queue, filterable by HSK level, with an "Easy"/"Hard"/unreviewed sub-filter; forgotten words can be re-added straight from the word detail page
- **Conversation** — one chat, three ways to talk to Gemini: type, hold the mic for one turn at a time (transcribed, graded, and read back to you), or open a live full-duplex voice call (Multimodal Live API over WebRTC). Tap any word in the transcript to see its definition and log it as a mistake; replay any message as audio and adjust playback speed
- **Reader** — Gemini-generated stories with per-character highlighting (known vs. queued vocabulary), click any character to queue it for review
- **My Vocabulary** — browse, search, and manage every word you've saved
- **Level Assessment** — a placement quiz to seed your starting HSK level
- **Friends** — send/accept friend requests by email, then compare progress (current HSK level, words tracked, streak) with anyone who's accepted; a notification badge on Profile tracks incoming requests and requests of yours that just got accepted
- Drag-to-reorder home screen — pick which learning mode leads
- English/中文 UI toggle

Home screen modes are reorderable (drag handle, persisted to `localStorage`) so you can put whichever practice mode you use most at the top.

> **Slang mode/review** (a separate informal-Mandarin track, plus a slang toggle in Conversation/Reader) is currently parked — disabled in the UI (commented out, not deleted) for a possible later version. The underlying data/schema (`data/slang.json`, `supabase/migrations/005_slang_bank.sql`, `slangBankLookup` in `lib/defineWord.ts`) is untouched.

### New-user onboarding

A brand-new account (zero saved words, never assessed — the same signal the Level Assessment redirect already used) is sent through a short chain before landing on the home screen:

1. **`/onboarding`** — a skippable checklist: add a Gemini API key (required for Conversation, Reader, and the AI dictionary fallback), add an ElevenLabs key (required for Conversation's push-to-talk mic — no shared fallback, see below), and set up the browser extension (optional, desktop Chrome/Edge). "Required" here means required for *that feature*, not to use the app at all — "Continue to app" always works, whether every step was done or none of them; each one can also be finished later from Profile.
2. **`/assessment`** — the existing placement quiz, unchanged.
3. Home.

Existing accounts are never retroactively dropped into this — it's gated on the same "brand new" signal as the assessment redirect, tracked via an `sm_onboarded` cookie (`app/actions/onboarding.ts`), mirroring the existing `sm_assessed` one.

**`/instructions`** (linked from Profile) is the standing reference version of the same setup checklist, plus a plain-language rundown of what every tab on the home screen does — available any time, not just on first run.

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
- **Dictionary data**: CC-CEDICT (bundled + Supabase-seeded), HSK vocabulary lists, a hand-curated slang bank (data seeded but feature currently parked, see Features)
- **Drag & drop**: `@dnd-kit`

## Project structure

```
app/
  _components/        Shared client components (global header/nav, language context)
  actions/             Server actions — getDueWords, submitReview, logMistake, addWord(s),
                        daily batch/streak (dailyLearning.ts), friend requests/progress
                        (friends.ts), onboarding status/completion
  api/                 Route handlers: converse, transcribe, grade-answer, grade-sentence,
                        generate-story, define-word, gemini-token, search-words, extension/*
  daily/               Daily word batch + next-day quiz, streak calendar
  review/              FSRS review session (HSK-filtered, hard/easy sub-filters)
  conversation/        Chat UI — text, hold-to-talk mic, and live voice call, one transcript
  reader/              Story generator + interactive reading view
  assessment/          HSK level placement quiz
  vocab/                Vocabulary browser + per-word detail page
  friends/             Friend requests (send/accept/decline) + per-friend progress comparison
  onboarding/          First-run setup checklist (new accounts only, skippable)
  instructions/        Standing setup checklist + what-each-tab-does reference (Profile link)
  settings/extension/  Manage browser-extension access tokens
  settings/gemini-key/ Manage your BYOK Gemini key
  settings/elevenlabs-key/ Manage your BYOK ElevenLabs key (optional — shared key works too)
  profile/             Account settings, friends notification badge, sign out
  manifest.ts          PWA manifest (icons, capture_links, theme)
lib/
  fsrs.ts              FSRS-4.5 scheduling algorithm + HSK injection logic
  streak.ts             Shared streak (gaps-and-islands) derivation — your own daily streak
                        and a friend's both run through this
  defineWord.ts         Shared dictionary-lookup core (used by both /api/define-word and
                        /api/extension/lookup)
  cedict.ts, segment.ts CC-CEDICT lookup + Chinese word segmentation
  extensionAuth.ts      Bearer-token auth for the browser extension / external clients
  supabase/             Browser + server Supabase clients, hand-authored DB types
browser-extension/      Chrome/Edge MV3 popup dictionary (see its own README)
supabase/migrations/    Full schema history (vocabulary_mastery, review_log, slang_bank,
                        cedict, extension_tokens, friend_requests, RLS policies, RPCs)
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
| `ELEVENLABS_API_KEY` | Optional — lets the app owner skip the settings-page BYOK flow for Conversation's push-to-talk mic transcription, same as `GEMINI_API_KEY_OWNER` below. Not a shared key for other users. |
| `SETTINGS_ENCRYPTION_KEY` | Encrypts users' BYOK Gemini/ElevenLabs keys at rest (`openssl rand -base64 32`) |
| `GEMINI_API_KEY_OWNER` / `OWNER_USER_ID` | Optional — lets the app owner skip the settings-page BYOK flow |
| `NEXT_PUBLIC_APP_URL` | Base URL used in generated links (browser extension "open full page", etc.) |

Story generation, conversation, and grading run on Gemini, but there's no app-wide Gemini key — every user brings their own (free, via [aistudio.google.com/apikey](https://aistudio.google.com/apikey)) from Profile → Gemini API key. See `lib/gemini/resolveKey.ts`.

Conversation's push-to-talk mic transcription works the same way — no shared key for regular users, by design, so nobody's usage eats into a quota that isn't theirs. Every user brings their own ElevenLabs key (free tier available) from Profile → ElevenLabs API key. `ELEVENLABS_API_KEY` only ever benefits the app owner's own account (`OWNER_USER_ID`), exactly like `GEMINI_API_KEY_OWNER` — see `lib/elevenlabs/resolveKey.ts`.

### Database

Apply `supabase/migrations/*.sql` in order (Supabase CLI or the SQL editor). Seed dictionary data with:

```bash
npm run build-cedict-db        # builds local CEDICT sqlite db from data/cedict.txt
node scripts/seed-cedict-supabase.mjs
node scripts/import-slang.mjs  # optional — feeds the slang bank, currently unused (see Features)
```

### Other scripts

- `npm run type-check` — TypeScript, no emit
- `npm run build` / `npm run start` — production build/serve

## Status

Actively developed. Auth, FSRS review, daily word batches + streak tracking, conversation practice, the story reader, friends (requests + progress comparison), the browser extension, and the PWA install path are all built and working. Slang mode/review is built but currently disabled in the UI (parked for a later version, see Features). Not yet built: a LangGraph-based stateful tutoring layer, automated CI, and native (Capacitor/Swift) app builds — the current install story is PWA-only, which covers Mac/iOS/desktop-Chrome installability but not App Store distribution or iOS Universal Links (both gated behind a paid Apple Developer account, deliberately deferred).

## Demos

https://github.com/user-attachments/assets/904f91ce-b8f3-4f2f-a13e-f4d0ef371cea

https://github.com/user-attachments/assets/c48188f1-3587-4f52-984d-6578ba7eafb0

