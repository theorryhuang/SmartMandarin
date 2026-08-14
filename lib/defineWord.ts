import type { SupabaseClient } from "@supabase/supabase-js";
import { cedictLookupAll, hskLookup, type DictResult } from "@/lib/cedict";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Core dictionary-lookup logic shared by /api/define-word (cookie-authed, in
 * the app) and /api/extension/lookup (bearer-token authed, the browser
 * extension). Takes an already-resolved supabase client + userId instead of
 * doing its own auth, so both callers can supply whichever fits how they
 * authenticated the request.
 *
 * No AI fallback: a word with no CEDICT/slang match returns the raw
 * character/sub-word breakdown instead of an AI-generated guess. An AI
 * guess got saved into vocabulary_mastery wrong once before (生意
 * postmortem) — showing "no definition, but here's what this decomposes
 * into" is honest instead of confidently wrong.
 */

export interface WordSense {
  pinyin: string;
  meaning: string;
  hsk_level?: number | null;
}

export interface WordPart {
  word: string;
  pinyin?: string;
  meaning?: string;
  hsk_level?: number | null;
}

export interface DefineWordResult {
  pinyin?: string;
  meaning?: string;
  hsk_level?: number | null;
  source?: "saved" | "cedict" | "slang";
  senses?: WordSense[];
  already_saved?: boolean;
  parts?: WordPart[];
  error?: string;
}

async function slangBankLookup(supabase: SupabaseClient<Database>, hanzi: string) {
  try {
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

function primaryEntry(entries: DictResult[]) {
  if (entries.length === 0) return null;
  const substantive = entries.filter(
    (e) => !/^(variant of|old variant of|see |abbr\.? for)/i.test(e.meaning.trim())
  );
  const candidates = substantive.length > 0 ? substantive : entries;
  return candidates.length > 1 ? { ...candidates[0], senses: candidates } : candidates[0];
}

// Forward maximum matching against CEDICT itself: at each position, try the
// longest remaining substring first and shrink until something hits, then
// continue from where that match ended. Segmentation and CEDICT are separate
// word lists, so a span like "一步步" may not be a CEDICT headword even
// though its pieces are — this walks the whole span into real headwords
// ("一" + "步步") instead of guessing one substring and dropping the rest.
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

export async function defineWord({
  supabase,
  userId,
  hanzi,
  slangMode,
}: {
  supabase: SupabaseClient<Database>;
  userId: string | null;
  hanzi: string;
  slangMode?: boolean;
}): Promise<DefineWordResult> {
  if (userId) {
    // A hanzi can now have multiple saved senses (行 xíng vs háng) — only
    // short-circuit here when there's exactly one, unambiguous saved row.
    // Multi-sense words fall through to the normal CEDICT path below; the
    // client merges in every saved sense from its own masteryMap anyway.
    const { data: existingRows } = await supabase
      .from("vocabulary_mastery")
      .select("pinyin, meaning, hsk_level")
      .eq("user_id", userId)
      .eq("hanzi", hanzi);
    const existing = existingRows?.length === 1 ? existingRows[0] : null;
    if (existing?.meaning) {
      return {
        pinyin: existing.pinyin ?? "",
        meaning: existing.meaning,
        hsk_level: existing.hsk_level ?? null,
        source: "saved",
        already_saved: true,
      };
    }
  }

  if (slangMode) {
    const slangResult = await slangBankLookup(supabase, hanzi);
    if (slangResult) return slangResult;
    const cedictResult = await resolveCedict(hanzi);
    if (cedictResult) return cedictResult;
  } else {
    const cedictResult = await resolveCedict(hanzi);
    if (cedictResult) return cedictResult;
    const slangResult = await slangBankLookup(supabase, hanzi);
    if (slangResult) return slangResult;
  }

  // Nothing in CEDICT or the slang bank for any part of this span. Surface
  // the raw character/sub-word breakdown (blank pinyin/meaning per part)
  // instead of an AI guess — see the module-level comment for why.
  const decomposed = await cedictDecompose(hanzi);
  const hsk_level = await hskLookup(hanzi);
  return {
    hsk_level,
    source: "cedict",
    parts: decomposed.map((p) => ({ word: p.word })),
  };
}
