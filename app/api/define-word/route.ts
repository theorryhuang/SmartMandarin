/**
 * POST /api/define-word
 * Body: { hanzi: string; slang_mode?: boolean }
 * Returns: { pinyin: string; meaning: string; source: "cedict" | "slang" | "ai" }
 *
 * Lookup order:
 *   textbook mode (default): CEDICT → slang_bank → AI
 *   slang mode: slang_bank → CEDICT → AI
 */
import { NextRequest, NextResponse } from "next/server";
import { cedictLookup, hskLookup } from "@/lib/cedict";
import { createClient } from "@/lib/supabase/server";

const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

async function slangBankLookup(hanzi: string) {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("slang_bank")
      .select("pinyin, meaning")
      .eq("hanzi", hanzi)
      .single() as { data: { pinyin: string | null; meaning: string } | null };
    if (data?.meaning) {
      const hsk_level = hskLookup(hanzi);
      return { pinyin: data.pinyin ?? "", meaning: data.meaning, hsk_level, source: "slang" as const };
    }
  } catch { /* ignore */ }
  return null;
}

export async function POST(req: NextRequest) {
  const { hanzi, slang_mode } = await req.json().catch(() => ({}));
  if (!hanzi) {
    return NextResponse.json({ error: "hanzi required" }, { status: 400 });
  }

  // Check if word already saved in user's vocabulary
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: existing } = await supabase
      .from("vocabulary_mastery")
      .select("pinyin, meaning, hsk_level")
      .eq("user_id", user.id)
      .eq("hanzi", hanzi)
      .maybeSingle();
    if (existing?.meaning) {
      return NextResponse.json({
        pinyin: existing.pinyin ?? "",
        meaning: existing.meaning,
        hsk_level: existing.hsk_level ?? null,
        source: "saved",
        already_saved: true,
      });
    }
  }

  if (slang_mode) {
    // Slang mode: slang_bank first, then CEDICT
    const slangResult = await slangBankLookup(hanzi);
    if (slangResult) return NextResponse.json(slangResult);
    const cedictResult = cedictLookup(hanzi);
    if (cedictResult) return NextResponse.json(cedictResult);
  } else {
    // Textbook mode: CEDICT first, then slang_bank
    const cedictResult = cedictLookup(hanzi);
    if (cedictResult) return NextResponse.json(cedictResult);
    const slangResult = await slangBankLookup(hanzi);
    if (slangResult) return NextResponse.json(slangResult);
  }

  // Not in either DB — look up HSK level independently before AI fallback
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
