/**
 * POST /api/generate-story
 * Body: { hsk_level: number; known_words: string[]; slang_mode: boolean; topic?: string }
 *
 * Uses Gemini Flash to generate a short story calibrated to the user's HSK level.
 * Returns structured JSON: { title, sentences: [{ hanzi, pinyin, english }] }
 */
import { NextRequest, NextResponse } from "next/server";

const MODEL = "gemini-2.0-flash";

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

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.9,
          maxOutputTokens: 1024,
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: err }, { status: res.status });
  }

  const raw = await res.json();
  const text = raw.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

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

Return ONLY valid JSON in exactly this shape (no markdown fences):
{
  "title": "story title in Chinese",
  "title_pinyin": "pinyin for title",
  "title_english": "English translation of title",
  "sentences": [
    {
      "hanzi": "full sentence in Chinese characters",
      "pinyin": "full pinyin with tone marks",
      "english": "natural English translation"
    }
  ]
}`;
}
