import { NextRequest, NextResponse } from "next/server";

const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const MODEL = "gemini-3.6-flash";

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });

  const {
    hsk_level = 3,
    known_words = [],
    slang_mode = false,
    topic,
  } = await req.json().catch(() => ({}));

  const prompt = buildPrompt(hsk_level, known_words, slang_mode, topic);

  try {
    const res = await fetch(INTERACTIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ model: MODEL, input: prompt, store: false }),
    });

    if (!res.ok) {
      const errText = await res.text();

      const msg = JSON.parse(errText)?.error?.message ?? errText;
      const message = msg.includes("quota") || msg.includes("RESOURCE_EXHAUSTED")
        ? "Gemini rate limit hit. Wait a moment and try again."
        : msg.slice(0, 200);
      return NextResponse.json({ error: message }, { status: 500 });
    }

    const data = await res.json();
    const modelStep = data.steps?.find((s: { type: string }) => s.type === "model_output");
    const text = modelStep?.content?.filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("") ?? "{}";
    const story = JSON.parse(text);
    return NextResponse.json(story);
  } catch (e) {

    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

function buildPrompt(hskLevel: number, knownWords: string[], slangMode: boolean, topic?: string): string {
  const topicLine = topic ? `The story should be about: ${topic}.` : "";
  const slangLine = slangMode
    ? "Include some modern Chinese internet slang (e.g. 绝绝子, yyds, 破防了, 摆烂) where natural."
    : "";
  const knownLine = knownWords.length > 0
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
