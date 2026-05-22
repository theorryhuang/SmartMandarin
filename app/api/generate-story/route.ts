/**
 * POST /api/generate-story
 * Body: { hsk_level: number; known_words: string[]; slang_mode: boolean; topic?: string }
 *
 * Uses Groq (free) to generate a short story calibrated to the user's HSK level.
 * Returns structured JSON: { title, sentences: [{ hanzi, pinyin, english }] }
 */
import { NextRequest, NextResponse } from "next/server";

const MODEL = "gemini-1.5-flash";
const API_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });
  }

  const {
    hsk_level = 3,
    known_words = [],
    slang_mode = false,
    topic,
  } = await req.json().catch(() => ({}));

  const prompt = buildPrompt(hsk_level, known_words, slang_mode, topic);

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.9,
      max_tokens: 1024,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    let message = `Story generation failed (${res.status})`;
    try {
      const errJson = JSON.parse(errText);
      const detail = errJson?.error?.message ?? errText;
      if (typeof detail === "string") {
        message = detail.includes("quota") || detail.includes("rate_limit")
          ? "Groq rate limit hit. Wait a moment and try again."
          : detail.slice(0, 200);
      }
    } catch {
      message = errText.slice(0, 200);
    }
    return NextResponse.json({ error: message }, { status: res.status });
  }

  const raw = await res.json();
  const text = raw.choices?.[0]?.message?.content ?? "{}";

  try {
    const story = JSON.parse(text);
    return NextResponse.json(story);
  } catch {
    return NextResponse.json({ error: "Failed to parse story JSON", raw: text }, { status: 500 });
  }
}

function buildPrompt(
  hskLevel: number,
  knownWords: string[],
  slangMode: boolean,
  topic?: string
): string {
  const topicLine = topic ? `The story should be about: ${topic}.` : "";
  const slangLine = slangMode
    ? "Include some modern Chinese internet slang (e.g. 绝绝子, yyds, 破防了, 摆烂) where natural."
    : "";
  const knownLine =
    knownWords.length > 0
      ? `The user already knows these words well — feel free to use them: ${knownWords.slice(0, 30).join("、")}.`
      : "";

  return `You are generating a short Mandarin reading passage for a language learner at HSK level ${hskLevel.toFixed(1)}.

Rules:
- Write exactly 6–8 sentences.
- Vocabulary should be appropriate for HSK level ${Math.floor(hskLevel)}, with occasional HSK ${Math.floor(hskLevel) + 1} words to gently challenge.
- Each sentence should be natural, not textbook-stiff.
${topicLine}
${slangLine}
${knownLine}

CRITICAL JSON rules — violating these makes the output useless:
- "title" MUST be Chinese characters (汉字) only — e.g. "约会的烦恼". NEVER pinyin.
- "hanzi" MUST be Chinese characters (汉字) only — e.g. "我今天很高兴。". NEVER pinyin.
- "pinyin" MUST be romanized pinyin with tone marks — e.g. "wǒ jīntiān hěn gāoxìng。". NEVER Chinese characters.
- "english" MUST be English — NEVER Chinese or pinyin.

Return ONLY valid JSON in exactly this shape (no markdown fences, no extra keys):
{
  "title": "汉字标题",
  "title_pinyin": "pīnyīn for title",
  "title_english": "English translation of title",
  "sentences": [
    {
      "hanzi": "用汉字写的完整句子。",
      "pinyin": "yòng hànzì xiě de wán zhěng jù zi。",
      "english": "natural English translation"
    }
  ]
}`;
}
