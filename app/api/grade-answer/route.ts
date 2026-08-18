import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { resolveGeminiKey } from "@/lib/gemini/resolveKey";
import { fetchGeminiInteractions } from "@/lib/gemini/interactions";

export async function POST(req: NextRequest) {
  let apiKey: string;
  try {
    ({ apiKey } = await resolveGeminiKey());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No Gemini key available" }, { status: 500 });
  }

  const { hanzi, correct_meaning, user_answer } = await req.json();
  if (!hanzi || !correct_meaning || user_answer === undefined) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const prompt = `You are grading a Mandarin vocabulary quiz. The Chinese word is "${hanzi}" and its correct English meaning is "${correct_meaning}".

The student typed: "${user_answer}"

Rules:
- Accept synonyms, paraphrases, and partial answers that capture the core meaning.
- Ignore spelling mistakes if the intent is clear.
- Reject completely wrong answers or blank responses.

Respond with ONLY valid JSON (no markdown, no extra text):
{"correct": true|false, "feedback": "one short sentence explaining why"}`;

  try {
    // Pin thinking_level low — without it this model uses dynamic thinking
    // and can spend 60+s deliberating on a simple grading call.
    const res = await fetchGeminiInteractions(apiKey, {
      input: prompt,
      store: false,
      generation_config: { thinking_level: "minimal", max_output_tokens: 200 },
    });

    if (!res.ok) {
      Sentry.captureMessage(`[grade-answer] Gemini API error ${res.status}`, "error");
      return NextResponse.json({ error: "Gemini API error" }, { status: 500 });
    }

    const data = await res.json();
    const modelStep = data.steps?.find((s: { type: string }) => s.type === "model_output");
    const raw = modelStep?.content?.filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("").trim() ?? "";

    const parsed = JSON.parse(raw);
    return NextResponse.json({ correct: Boolean(parsed.correct), feedback: parsed.feedback ?? "" });
  } catch (e) {
    Sentry.captureException(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
