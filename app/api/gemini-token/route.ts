/**
 * Issues Gemini Live session config (model + system prompt + key) so the
 * client can open its own WebRTC connection. The key is resolved per-caller
 * via resolveGeminiKey() — see the comment on api_key below for why that's
 * fine to hand back even though it's client-visible.
 *
 * POST /api/gemini-token
 * Body: { slang_mode: boolean, forced_words: string[] }
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveGeminiKey } from "@/lib/gemini/resolveKey";

const GEMINI_LIVE_MODEL = "models/gemini-2.0-flash-live-001";

export async function POST(req: NextRequest) {
  let apiKey: string;
  try {
    ({ apiKey } = await resolveGeminiKey());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No Gemini key available" }, { status: 500 });
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
    // The Gemini Live WebRTC handshake requires the raw key client-side —
    // there's no server-proxy option for this API today. resolveGeminiKey()
    // means what's exposed here is the caller's own BYOK key when they have
    // one, so a leaked key only ever spends *their* quota, not the shared
    // pool's. Users without their own key still get the shared/owner key,
    // same exposure as before.
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
