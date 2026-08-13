import { NextRequest, NextResponse } from "next/server";
import { cedictLookupAll, hskLookup, type DictResult } from "@/lib/cedict";
import { createClient } from "@/lib/supabase/server";

const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const MODEL = "gemini-3.1-flash-lite"; // free tier: RPM 15, RPD 500 vs 3.6-flash's RPM 5, RPD 20

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

async function geminiJSON(prompt: string, apiKey: string, maxTokens = 64): Promise<string> {
  try {
    const res = await fetch(INTERACTIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      // thinking_level "low" (not "minimal"): this route fires live mid-conversation
      // (tap-to-define), so a rushed answer is more disruptive than an extra ~1s here.
      body: JSON.stringify({
        model: MODEL,
        input: prompt,
        store: false,
        generation_config: { thinking_level: "low", max_output_tokens: maxTokens },
      }),
    });
    if (!res.ok) return "{}";
    const data = await res.json();
    const modelStep = data.steps?.find((s: { type: string }) => s.type === "model_output");
    return modelStep?.content?.filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("") ?? "{}";
  } catch {
    return "{}";
  }
}

export async function POST(req: NextRequest) {
  const { hanzi, slang_mode } = await req.json().catch(() => ({}));
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

  // No auto-disambiguation: when a word has multiple senses in CEDICT, we
  // return all of them (as `senses`) and let the caller show a picker rather
  // than silently guessing one (a prior AI tiebreaker guessed wrong and got
  // saved into vocabulary_mastery — see 生意 postmortem).
  const resolveCedict = (entries: DictResult[]) => {
    if (entries.length === 0) return null;
    const substantive = entries.filter(
      (e) => !/^(variant of|old variant of|see |abbr\.? for)/i.test(e.meaning.trim())
    );
    const candidates = substantive.length > 0 ? substantive : entries;
    return candidates.length > 1
      ? { ...candidates[0], senses: candidates }
      : candidates[0];
  };

  if (slang_mode) {
    const slangResult = await slangBankLookup(hanzi);
    if (slangResult) return NextResponse.json(slangResult);
    const cedictResult = resolveCedict(await cedictLookupAll(hanzi));
    if (cedictResult) return NextResponse.json(cedictResult);
  } else {
    const cedictResult = resolveCedict(await cedictLookupAll(hanzi));
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
