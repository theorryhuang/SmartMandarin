import { NextRequest, NextResponse } from "next/server";
import { cedictLookupAll, hskLookup, type DictResult } from "@/lib/cedict";
import { createClient } from "@/lib/supabase/server";

const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const MODEL = "gemini-3.6-flash";

async function slangBankLookup(hanzi: string) {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("slang_bank")
      .select("pinyin, meaning")
      .eq("hanzi", hanzi)
      .single() as { data: { pinyin: string | null; meaning: string } | null };
    if (data?.meaning) {
      const hsk_level = await hskLookup(hanzi);
      return { pinyin: data.pinyin ?? "", meaning: data.meaning, hsk_level, source: "slang" as const };
    }
  } catch { /* ignore */ }
  return null;
}

async function geminiJSON(prompt: string, apiKey: string, _maxTokens = 64): Promise<string> {
  try {
    const res = await fetch(INTERACTIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ model: MODEL, input: prompt, store: false }),
    });
    if (!res.ok) return "{}";
    const data = await res.json();
    const modelStep = data.steps?.find((s: { type: string }) => s.type === "model_output");
    return modelStep?.content?.filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("") ?? "{}";
  } catch {
    return "{}";
  }
}

async function aiTiebreaker(hanzi: string, entries: DictResult[], context: string, apiKey: string): Promise<DictResult> {
  const choices = entries.map((e, i) => `${i + 1}. ${e.pinyin}: ${e.meaning}`).join("\n");
  const prompt = `Sentence: "${context}"
Word in sentence: "${hanzi}"

Pick the correct definition:
${choices}

Reply with ONLY valid JSON: {"index": <1-based number>}`;

  try {
    const text = await geminiJSON(prompt, apiKey, 16);
    const parsed = JSON.parse(text);
    const idx = (parsed.index ?? 1) - 1;
    return entries[idx] ?? entries[0];
  } catch { /* fall through */ }
  return entries[0];
}

export async function POST(req: NextRequest) {
  const { hanzi, slang_mode, context } = await req.json().catch(() => ({}));
  if (!hanzi) return NextResponse.json({ error: "hanzi required" }, { status: 400 });

  const apiKey = process.env.GEMINI_API_KEY;

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

  const resolveCedict = async (entries: DictResult[]) => {
    if (entries.length === 0) return null;
    const substantive = entries.filter(
      (e) => !/^(variant of|old variant of|see |abbr\.? for)/i.test(e.meaning.trim())
    );
    const candidates = substantive.length > 0 ? substantive : entries;
    if (candidates.length === 1 || !context || !apiKey) return candidates[0];
    return aiTiebreaker(hanzi, candidates, context, apiKey);
  };

  if (slang_mode) {
    const slangResult = await slangBankLookup(hanzi);
    if (slangResult) return NextResponse.json(slangResult);
    const cedictResult = await resolveCedict(await cedictLookupAll(hanzi));
    if (cedictResult) return NextResponse.json(cedictResult);
  } else {
    const cedictResult = await resolveCedict(await cedictLookupAll(hanzi));
    if (cedictResult) return NextResponse.json(cedictResult);
    const slangResult = await slangBankLookup(hanzi);
    if (slangResult) return NextResponse.json(slangResult);
  }

  const hsk_level = await hskLookup(hanzi);
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });

  const prompt = `You are a Mandarin dictionary. Define the word or phrase "${hanzi}".

Return ONLY valid JSON (no markdown, no extra keys):
{
  "pinyin": "pīnyīn with tone marks",
  "meaning": "concise English definition (≤10 words)"
}`;

  try {
    const text = await geminiJSON(prompt, apiKey, 128);
    const def = JSON.parse(text);
    return NextResponse.json({ pinyin: def.pinyin ?? "", meaning: def.meaning ?? "", hsk_level, source: "ai" });
  } catch {
    return NextResponse.json({ error: "Failed to parse response" }, { status: 500 });
  }
}
