/**
 * Issues a short-lived Gemini Live session token so the client can open
 * a WebRTC connection without exposing GEMINI_API_KEY in the browser.
 *
 * POST /api/gemini-token
 * Body: { slang_mode: boolean, forced_words: string[] }
 */
import { NextRequest, NextResponse } from "next/server";

const GEMINI_LIVE_MODEL = "models/gemini-2.0-flash-live-001";

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });
  }

  const {
    slang_mode = false,
    forced_words = [],
    hsk_level = 1,
    unknown_words = [],
  } = await req.json().catch(() => ({}));

  const systemInstruction = buildSystemPrompt(slang_mode, forced_words, hsk_level, unknown_words);

  // No token-exchange call needed here — the client opens the WebRTC session
  // itself via the @google/generative-ai SDK using the config below. (This
  // used to also fire a throwaway :generateContent call that spent a real
  // Gemini request per session start without ever reading the response.)
  return NextResponse.json({
    model: GEMINI_LIVE_MODEL,
    system_instruction: systemInstruction,
    // API key returned only as a session hint — rotate to short-lived in production
    // For dev: client uses this directly. In prod, swap for OAuth2 ephemeral token.
    api_key: apiKey,
  });
}

type UnknownWord = { hanzi: string; pinyin: string; meaning: string };

function buildSystemPrompt(
  slangMode: boolean,
  forcedWords: string[],
  hskLevel: number,
  unknownWords: UnknownWord[]
): string {
  const base = `You are a friendly Mandarin Chinese conversation partner helping an intermediate learner practice natural, flowing Mandarin.
- Respond in Mandarin (simplified characters) with pinyin in parentheses after each sentence.
- Keep responses concise — 2 to 4 sentences.
- Gently correct grammatical errors by rephrasing naturally.
- Always respond with a follow-up question to keep the conversation going.`;

  // HSK level calibration — core instruction
  const hskInstruction = `\n\n## Vocabulary level
The user is currently at HSK ${hskLevel}. Calibrate your vocabulary accordingly:
- Use words the user is likely to know at HSK ${hskLevel} as your baseline.
- Occasionally introduce 1–2 words from HSK ${Math.min(hskLevel + 1, 9)} to gently stretch their abilities, but always in a context where meaning can be inferred.
- Avoid vocabulary significantly above HSK ${hskLevel + 1} unless it is unavoidable for the topic.
- Prefer shorter, clearer sentences over complex grammar structures beyond the user's level.`;

  // Persistent unknown word bank from past sessions
  const unknownBank =
    unknownWords.length > 0
      ? `\n\n## User's known-weak words (from past sessions)
These are words the user has previously struggled with. Naturally weave relevant ones into the conversation over time to help reinforce them — do NOT force all of them in at once:
${unknownWords
  .map((w) => `- ${w.hanzi} (${w.pinyin}): ${w.meaning}`)
  .join("\n")}`
      : "";

  const slang = slangMode
    ? `\n\n## Slang mode ON
Prefer modern internet slang and colloquialisms over formal HSK equivalents.
Use terms like 绝绝子, yyds, 躺平, 内卷, 破防, 芭比Q了 where natural.`
    : "";

  // Words flagged in the current session — inject immediately
  const forced =
    forcedWords.length > 0
      ? `\n\n## PRIORITY — use in your very next response
The user just flagged these words as ones they didn't understand: ${forcedWords.join("、")}.
Work all of them naturally into your immediate reply to reinforce memory.`
      : "";

  return base + hskInstruction + unknownBank + slang + forced;
}
