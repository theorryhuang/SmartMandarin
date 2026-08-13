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
    // A hanzi can now have multiple saved senses (行 xíng vs háng) — only
    // short-circuit here when there's exactly one, unambiguous saved row.
    // Multi-sense words fall through to the normal CEDICT/AI path below;
    // the client merges in every saved sense from its own masteryMap anyway.
    const { data: existingRows } = await supabase
      .from("vocabulary_mastery")
      .select("pinyin, meaning, hsk_level")
      .eq("user_id", user.id)
      .eq("hanzi", hanzi);
    const existing = existingRows?.length === 1 ? existingRows[0] : null;
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
  function primaryEntry(entries: DictResult[]) {
    if (entries.length === 0) return null;
    const substantive = entries.filter(
      (e) => !/^(variant of|old variant of|see |abbr\.? for)/i.test(e.meaning.trim())
    );
    const candidates = substantive.length > 0 ? substantive : entries;
    return candidates.length > 1 ? { ...candidates[0], senses: candidates } : candidates[0];
  }

  // Forward maximum matching against CEDICT itself: at each position, try
  // the longest remaining substring first and shrink until something hits,
  // then continue from where that match ended. Segmentation (Intl.Segmenter)
  // and CEDICT are separate word lists, so a segmented span like "一步步"
  // may not be a CEDICT headword even though its pieces are — this walks
  // the whole span into real headwords ("一" + "步步") instead of guessing
  // one substring and dropping the rest.
  async function cedictDecompose(word: string): Promise<{ word: string; entries: DictResult[] }[]> {
    const chars = Array.from(word);
    const parts: { word: string; entries: DictResult[] }[] = [];
    let i = 0;
    while (i < chars.length) {
      let hit: { sub: string; entries: DictResult[] } | null = null;
      for (let len = chars.length - i; len >= 1; len--) {
        const sub = chars.slice(i, i + len).join("");
        const entries = await cedictLookupAll(sub);
        if (entries.length > 0) {
          hit = { sub, entries };
          break;
        }
      }
      if (hit) {
        parts.push({ word: hit.sub, entries: hit.entries });
        i += Array.from(hit.sub).length;
      } else {
        parts.push({ word: chars[i], entries: [] }); // no CEDICT entry at all for this char
        i += 1;
      }
    }
    return parts;
  }

  async function resolveCedict(word: string) {
    const direct = primaryEntry(await cedictLookupAll(word));
    if (direct) return direct; // whole span is a real headword — done

    const decomposed = await cedictDecompose(word);
    if (decomposed.every((p) => p.entries.length === 0)) return null; // nothing found anywhere

    const parts = decomposed.map((p) => {
      const entry = primaryEntry(p.entries);
      return { word: p.word, pinyin: entry?.pinyin, meaning: entry?.meaning, hsk_level: entry?.hsk_level };
    });
    return {
      pinyin: parts.map((p) => p.pinyin).filter(Boolean).join(" "),
      meaning: parts.map((p) => p.meaning).filter(Boolean).join(" + "),
      hsk_level: parts.find((p) => p.hsk_level != null)?.hsk_level ?? null,
      source: "cedict" as const,
      parts,
    };
  }

  if (slang_mode) {
    const slangResult = await slangBankLookup(hanzi);
    if (slangResult) return NextResponse.json(slangResult);
    const cedictResult = await resolveCedict(hanzi);
    if (cedictResult) return NextResponse.json(cedictResult);
  } else {
    const cedictResult = await resolveCedict(hanzi);
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
