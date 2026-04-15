/**
 * Grades a user's typed English meaning against the correct answer.
 *
 * POST /api/grade-answer
 * Body: { hanzi: string; correct_meaning: string; user_answer: string }
 * Returns: { correct: boolean; feedback: string }
 */
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });
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

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 100 },
      }),
    }
  );

  if (!res.ok) {
    return NextResponse.json({ error: "Gemini API error" }, { status: 500 });
  }

  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  try {
    const parsed = JSON.parse(raw.trim());
    return NextResponse.json({ correct: Boolean(parsed.correct), feedback: parsed.feedback ?? "" });
  } catch {
    // Fallback: if JSON parse fails, do simple string match
    const correct = raw.toLowerCase().includes('"correct": true') || raw.toLowerCase().includes('"correct":true');
    return NextResponse.json({ correct, feedback: "" });
  }
}
