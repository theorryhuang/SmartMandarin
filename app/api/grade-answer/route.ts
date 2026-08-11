import { NextRequest, NextResponse } from "next/server";

const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const MODEL = "gemini-3.6-flash";

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });

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
    const res = await fetch(INTERACTIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ model: MODEL, input: prompt, store: false }),
    });

    if (!res.ok) {

      return NextResponse.json({ error: "Gemini API error" }, { status: 500 });
    }

    const data = await res.json();
    const modelStep = data.steps?.find((s: { type: string }) => s.type === "model_output");
    const raw = modelStep?.content?.filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("").trim() ?? "";

    const parsed = JSON.parse(raw);
    return NextResponse.json({ correct: Boolean(parsed.correct), feedback: parsed.feedback ?? "" });
  } catch (e) {

    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
