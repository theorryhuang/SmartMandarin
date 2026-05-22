/**
 * POST /api/converse
 * Body: {
 *   userMessage: string,
 *   history: { role: "user" | "assistant", content: string }[],
 *   slang_mode: boolean,
 *   forced_words: string[],
 *   hsk_level: number,
 *   unknown_words: { hanzi, pinyin, meaning }[],
 * }
 * Returns: { reply: string }
 *
 * Uses Groq LLaMA (free) for Mandarin conversation responses.
 */
import { NextRequest, NextResponse } from "next/server";

const MODEL = "gemini-2.0-flash";
const API_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

type UnknownWord = { hanzi: string; pinyin: string; meaning: string };

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });
  }

  const {
    userMessage,
    history = [],
    slang_mode = false,
    forced_words = [],
    hsk_level = 1,
    unknown_words = [],
  } = await req.json().catch(() => ({}));

  if (!userMessage) {
    return NextResponse.json({ error: "No userMessage provided" }, { status: 400 });
  }

  const systemPrompt = buildSystemPrompt(slang_mode, forced_words, hsk_level, unknown_words);

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.slice(-10), // keep last 10 turns for context
    { role: "user", content: userMessage },
  ];

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.8,
      max_tokens: 512,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    let message = `Conversation failed (${res.status})`;
    try {
      const errJson = JSON.parse(errText);
      message = errJson?.error?.message?.slice(0, 200) ?? message;
    } catch { /* noop */ }
    return NextResponse.json({ error: message }, { status: res.status });
  }

  const data = await res.json();
  const raw: string = data.choices?.[0]?.message?.content ?? "";
  const reply = stripBoilerplate(raw);
  return NextResponse.json({ reply });
}

function stripBoilerplate(text: string): string {
  // Strip Chinese social-media engagement phrases LLaMA appends from training data
  return text
    .replace(/请不吝点赞[^\n]*/g, "")
    .replace(/喜欢的话.*?(订阅|关注)[^\n]*/g, "")
    .replace(/记得.*?(点赞|订阅|关注)[^\n]*/g, "")
    .trim();
}

function buildSystemPrompt(
  slangMode: boolean,
  forcedWords: string[],
  hskLevel: number,
  unknownWords: UnknownWord[]
): string {
  const base = `You are 小灵, a friendly Mandarin Chinese conversation partner helping a learner practice natural, flowing Mandarin.
- Respond ONLY in Mandarin (simplified characters). Do NOT include pinyin or romanization anywhere in your responses.
- Keep responses concise — 2 to 4 sentences.
- Gently correct grammatical errors by rephrasing naturally.
- Always end with a follow-up question to keep the conversation going.
- NEVER include social media calls to action (点赞、订阅、转发、打赏、关注 etc.) in your response.`;

  const hskInstruction = `\n\nThe user is at HSK ${hskLevel}. Use vocabulary appropriate for that level. Occasionally introduce 1–2 HSK ${Math.min(hskLevel + 1, 9)} words where meaning can be inferred from context.`;

  const unknownBank =
    unknownWords.length > 0
      ? `\n\nWords the user has struggled with — weave relevant ones in naturally over time:\n${unknownWords
          .map((w) => `- ${w.hanzi} (${w.pinyin}): ${w.meaning}`)
          .join("\n")}`
      : "";

  const slang = slangMode
    ? `\n\nSlang mode ON: prefer modern internet slang (绝绝子, yyds, 躺平, 内卷, 破防, 芭比Q了) over formal equivalents.`
    : "";

  const forced =
    forcedWords.length > 0
      ? `\n\nPRIORITY: the user just flagged these words as unknown: ${forcedWords.join("、")}. Work ALL of them into your very next reply.`
      : "";

  return base + hskInstruction + unknownBank + slang + forced;
}
