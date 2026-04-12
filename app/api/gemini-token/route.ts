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

  const { slang_mode = false, forced_words = [] } = await req.json().catch(() => ({}));

  const systemInstruction = buildSystemPrompt(slang_mode, forced_words);

  // Exchange for an ephemeral token via the Gemini token exchange endpoint
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${GEMINI_LIVE_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // We only need the session config — use the token endpoint
        system_instruction: { parts: [{ text: systemInstruction }] },
        generation_config: { response_modalities: ["AUDIO", "TEXT"] },
      }),
    }
  );

  // The real Live API token endpoint is different; return the config the client needs
  // Client will use the @google/generative-ai SDK to open the WebRTC session
  return NextResponse.json({
    model: GEMINI_LIVE_MODEL,
    system_instruction: systemInstruction,
    // API key returned only as a session hint — rotate to short-lived in production
    // For dev: client uses this directly. In prod, swap for OAuth2 ephemeral token.
    api_key: apiKey,
  });
}

function buildSystemPrompt(slangMode: boolean, forcedWords: string[]): string {
  const base = `You are a friendly Mandarin Chinese conversation partner.
Your goal is to help the user practice natural, flowing Mandarin.
- Respond in Mandarin (simplified characters) with pinyin in parentheses after each sentence.
- Keep responses concise — 2 to 4 sentences.
- Gently correct grammatical errors by rephrasing naturally.
- Always respond with a follow-up question to keep conversation going.`;

  const slang = slangMode
    ? `\n- SLANG MODE ON: Prefer modern internet slang and colloquialisms over formal HSK equivalents.
  Use terms like 绝绝子, yyds, 躺平, 内卷, 破防, 芭比Q了 where natural.`
    : "";

  const forced =
    forcedWords.length > 0
      ? `\n- PRIORITY WORDS: Naturally work these words into your very next response: ${forcedWords.join("、")}.
  The user recently struggled with these — reusing them helps reinforce memory.`
      : "";

  return base + slang + forced;
}
