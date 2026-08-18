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
  /** Every CEDICT sense for this part, when it has more than one (e.g. 乘
   *  as Chéng/chéng/shèng) — pinyin/meaning above are just senses[0]. */
  senses?: WordSense[];
}

export interface DefineWordResult {
  pinyin?: string;
  meaning?: string;
  hsk_level?: number | null;
  source?: "saved" | "cedict" | "slang";
  senses?: WordSense[];
  already_saved?: boolean;
  /**
   * Every currently-saved row for this exact hanzi, straight from the DB at
   * lookup time — regardless of which branch below ends up answering the
   * request. Exists so a caller with no live masteryMap of its own (the
   * browser extension: see browser-extension/content.js's isSaved) can still
   * show accurate +/- state without a second, separately-cached fetch. Only
   * populated when `userId` is given; omitted (not just empty) when it
   * isn't, so callers can tell "not logged in" apart from "logged in, saved
   * nothing".
   */
  saved_senses?: { id: string; pinyin: string; meaning: string; hsk_level: number | null }[];
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

function primaryEntry(entries: DictResult[]): (DictResult & { senses?: DictResult[] }) | null {
  if (entries.length === 0) return null;
  const substantive = entries.filter(
    (e) => !/^(variant of|old variant of|see |abbr\.? for)/i.test(e.meaning.trim())
  );
  const candidates = substantive.length > 0 ? substantive : entries;
  return candidates.length > 1 ? { ...candidates[0], senses: candidates } : candidates[0];
}

// Maximum matching against CEDICT itself, run in BOTH directions and unioned.
// At each position, try the longest remaining substring first and shrink
// until something hits, then continue from where that match ended — but a
// single left-to-right pass picks *one* parse and silently hides any other
// valid one. "耀华中学" (Yaohua Middle School) forward-greedy reads as
// 耀+华中+学 ("central China" + a lone character) — real CEDICT words, but
// the wrong split; a backward pass from the right finds 学+中学+华+耀 instead,
// correctly keeping "中学" (middle school) together. Neither direction is
// reliably "more correct" in general, so instead of guessing, union both:
// surface every real headword either pass finds — 天津市/耀/华中/学/华/中学 all
// show up as their own candidate — rather than committing to one split and
// dropping the alternative.
async function maxMatchWalk(
  chars: string[],
  forward: boolean
): Promise<{ word: string; entries: DictResult[]; start: number }[]> {
  const n = chars.length;
  const out: { word: string; entries: DictResult[]; start: number }[] = [];
  let i = forward ? 0 : n;
  while (forward ? i < n : i > 0) {
    let hit: { sub: string; entries: DictResult[]; start: number } | null = null;
    const remaining = forward ? n - i : i;
    for (let len = remaining; len >= 1; len--) {
      const start = forward ? i : i - len;
      const sub = chars.slice(start, start + len).join("");
      const entries = await cedictLookupAll(sub);
      if (entries.length > 0) {
        hit = { sub, entries, start };
        break;
      }
    }
    if (hit) {
      out.push({ word: hit.sub, entries: hit.entries, start: hit.start });
      i = forward ? i + Array.from(hit.sub).length : i - Array.from(hit.sub).length;
    } else {
      const start = forward ? i : i - 1;
      out.push({ word: chars[start], entries: [], start }); // no CEDICT entry at all for this char
      i = forward ? i + 1 : i - 1;
    }
  }
  return forward ? out : out.reverse();
}

export async function cedictDecompose(word: string): Promise<{ word: string; entries: DictResult[] }[]> {
  const chars = Array.from(word);
  const [fwd, bwd] = await Promise.all([maxMatchWalk(chars, true), maxMatchWalk(chars, false)]);

  // Union by word text — prefer whichever pass actually found real entries
  // (a char that's a real single-char word in one direction shouldn't be
  // shadowed by an empty-entries fallback hit from the other).
  const byWord = new Map<string, { word: string; entries: DictResult[]; start: number }>();
  for (const hit of [...fwd, ...bwd]) {
    const existing = byWord.get(hit.word);
    if (!existing || (existing.entries.length === 0 && hit.entries.length > 0)) {
      byWord.set(hit.word, hit);
    }
  }
  return [...byWord.values()]
    .sort((a, b) => a.start - b.start || b.word.length - a.word.length)
    .map(({ word, entries }) => ({ word, entries }));
}

async function resolveCedict(word: string) {
  const direct = primaryEntry(await cedictLookupAll(word));
  if (direct) return direct; // whole span is a real headword — done

  const decomposed = await cedictDecompose(word);
  if (decomposed.every((p) => p.entries.length === 0)) return null; // nothing found anywhere

  const parts = decomposed.map((p) => {
    const entry = primaryEntry(p.entries);
    return { word: p.word, pinyin: entry?.pinyin, meaning: entry?.meaning, hsk_level: entry?.hsk_level, senses: entry?.senses };
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
  // Fetched once up front and attached to *every* return path below (via the
  // `result` variable, not repeated per-branch) — not just the single-row
  // shortcut's own case. A caller with no live masteryMap of its own (the
  // extension) previously had no way to know a word was saved unless it hit
  // that exact shortcut; anything else (multiple saved senses, or a fresh
  // CEDICT/slang/decomposed result) silently omitted saved state entirely.
  let savedRows: { id: string; pinyin: string; meaning: string; hsk_level: number | null }[] = [];
  if (userId) {
    const { data: existingRows } = await supabase
      .from("vocabulary_mastery")
      .select("id, pinyin, meaning, hsk_level")
      .eq("user_id", userId)
      .eq("hanzi", hanzi);
    savedRows = existingRows ?? [];

    // A hanzi can have multiple saved senses (行 xíng vs háng) — only
    // short-circuit here when there's exactly one, unambiguous saved row.
    // Multi-sense words fall through to the normal CEDICT path below; the
    // app's own client merges in every saved sense from its own masteryMap
    // anyway, and saved_senses below covers the extension.
    const existing = savedRows.length === 1 ? savedRows[0] : null;
    if (existing?.meaning) {
      return {
        pinyin: existing.pinyin ?? "",
        meaning: existing.meaning,
        hsk_level: existing.hsk_level ?? null,
        source: "saved",
        already_saved: true,
        saved_senses: savedRows,
      };
    }
  }

  const result = await resolveDefinition(supabase, hanzi, slangMode);
  return userId ? { ...result, saved_senses: savedRows } : result;
}

async function resolveDefinition(
  supabase: SupabaseClient<Database>,
  hanzi: string,
  slangMode?: boolean
): Promise<DefineWordResult> {
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
