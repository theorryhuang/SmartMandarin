import { NextRequest, NextResponse } from "next/server";

const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const MODEL = "gemini-3.6-flash";

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });

  const { hanzi, pinyin, meaning, sentence } = await req.json().catch(() => ({}));
  if (!hanzi || !sentence || !String(sentence).trim()) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const prompt = `You are a Mandarin teacher grading a student's practice sentence. The target word is "${hanzi}"${pinyin ? ` (${pinyin})` : ""}${meaning ? `, meaning "${meaning}"` : ""}.

The student wrote this sentence: "${sentence}"

Evaluate it:
- grammatical: is the sentence grammatically correct Mandarin?
- uses_word: does it actually use "${hanzi}" with its correct meaning/usage (not just present as characters, but semantically correct)?
- natural: would a native speaker phrase it this way?

Respond with ONLY valid JSON (no markdown, no extra text):
{
  "valid": true|false,
  "natural": true|false,
  "feedback": "one short encouraging sentence in English explaining what's right or wrong",
  "corrected": "a natural corrected/improved version of the sentence, or null if no changes needed"
}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const res = await fetch(INTERACTIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      // thinking_level pinned to "minimal": without it gemini-3.6-flash uses
      // dynamic thinking and can burn 60+s of hidden reasoning on subjective
      // calls (e.g. "is this natural?"). This is a short classification task,
      // not something that needs deep deliberation.
      body: JSON.stringify({
        model: MODEL,
        input: prompt,
        store: false,
        generation_config: { thinking_level: "minimal", max_output_tokens: 300 },
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) {
      return NextResponse.json({ error: "Gemini API error" }, { status: 500 });
    }

    const data = await res.json();
    const modelStep = data.steps?.find((s: { type: string }) => s.type === "model_output");
    const raw = modelStep?.content?.filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("").trim() ?? "";

    const parsed = JSON.parse(raw);
    return NextResponse.json({
      valid: Boolean(parsed.valid),
      natural: Boolean(parsed.natural),
      feedback: parsed.feedback ?? "",
      corrected: parsed.corrected ?? null,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return NextResponse.json({ error: "Gemini timed out" }, { status: 504 });
    }
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
