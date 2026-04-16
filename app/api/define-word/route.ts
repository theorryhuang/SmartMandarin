/**
 * POST /api/define-word
 * Body: { hanzi: string; hsk_level?: number }
 * Returns: { pinyin: string; meaning: string; source: "cedict" | "ai" }
 *
 * Lookup order: CC-CEDICT (authoritative) → Groq LLM fallback for phrases not in dict.
 */
import { NextRequest, NextResponse } from "next/server";
import { cedictLookup, hskLookup } from "@/lib/cedict";

const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

export async function POST(req: NextRequest) {
  const { hanzi } = await req.json().catch(() => ({}));
  if (!hanzi) {
    return NextResponse.json({ error: "hanzi required" }, { status: 400 });
  }

  // 1. Try CEDICT first
  const cedictResult = cedictLookup(hanzi);
  if (cedictResult) {
    return NextResponse.json(cedictResult);
  }

  // Not in CEDICT — look up HSK level independently before AI fallback
  const hsk_level = hskLookup(hanzi);

  // 2. Groq fallback for multi-word phrases / proper nouns not in CEDICT
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GROQ_API_KEY not set" }, { status: 500 });
  }

  const prompt = `You are a Mandarin dictionary. Define the word or phrase "${hanzi}".

Return ONLY valid JSON (no markdown, no extra keys):
{
  "pinyin": "pīnyīn with tone marks",
  "meaning": "concise English definition (≤10 words)"
}`;

  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 128,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: `Groq error ${res.status}` }, { status: res.status });
  }

  const raw = await res.json();
  const text = raw.choices?.[0]?.message?.content ?? "{}";

  try {
    const def = JSON.parse(text);
    return NextResponse.json({
      pinyin: def.pinyin ?? "",
      meaning: def.meaning ?? "",
      hsk_level,
      source: "ai",
    });
  } catch {
    return NextResponse.json({ error: "Failed to parse response" }, { status: 500 });
  }
}
