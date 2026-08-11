/**
 * CEDICT lookup module — Supabase-backed.
 * Server-side only (called from API routes).
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/** Tone-number pinyin → tone-mark pinyin. e.g. "qing2 jie2" → "qíng jié" */
function toToneMarks(numbered: string): string {
  const toneMap: Record<string, string[]> = {
    a: ["a", "ā", "á", "ǎ", "à"],
    e: ["e", "ē", "é", "ě", "è"],
    i: ["i", "ī", "í", "ǐ", "ì"],
    o: ["o", "ō", "ó", "ǒ", "ò"],
    u: ["u", "ū", "ú", "ǔ", "ù"],
    ü: ["ü", "ǖ", "ǘ", "ǚ", "ǜ"],
    v: ["ü", "ǖ", "ǘ", "ǚ", "ǜ"],
  };

  return numbered
    .split(" ")
    .map((syllable) => {
      const toneMatch = syllable.match(/([1-5])$/);
      if (!toneMatch) return syllable;
      const tone = parseInt(toneMatch[1]);
      const base = syllable.slice(0, -1);
      const lower = base.toLowerCase();
      let result = base;

      if (lower.includes("a")) {
        result = base.replace(/a/gi, (c) => {
          const m = toneMap.a[tone] ?? c;
          return c === "A" ? m.toUpperCase() : m;
        });
      } else if (lower.includes("e")) {
        result = base.replace(/e/gi, (c) => {
          const m = toneMap.e[tone] ?? c;
          return c === "E" ? m.toUpperCase() : m;
        });
      } else if (lower.includes("ou")) {
        result = base.replace(/o/gi, (c) => {
          const m = toneMap.o[tone] ?? c;
          return c === "O" ? m.toUpperCase() : m;
        });
      } else {
        const vowels = ["a", "e", "i", "o", "u", "ü", "v"];
        let lastIdx = -1;
        let lastVowel = "";
        for (let i = 0; i < lower.length; i++) {
          if (vowels.includes(lower[i])) {
            lastIdx = i;
            lastVowel = lower[i];
          }
        }
        if (lastIdx >= 0) {
          const key = lastVowel === "v" ? "v" : lastVowel;
          result =
            base.slice(0, lastIdx) +
            (toneMap[key]?.[tone] ?? base[lastIdx]) +
            base.slice(lastIdx + 1);
        }
      }

      return result;
    })
    .join(" ");
}

export interface DictResult {
  pinyin: string;
  meaning: string;
  hsk_level: number | null;
  source: "cedict" | "ai";
}

export async function cedictLookup(hanzi: string): Promise<DictResult | null> {
  const results = await cedictLookupAll(hanzi);
  return results[0] ?? null;
}

export async function cedictLookupAll(hanzi: string): Promise<DictResult[]> {
  const { data } = await supabase
    .from("cedict")
    .select("pinyin, english")
    .eq("simplified", hanzi)
    .limit(10);

  if (!data || data.length === 0) return [];

  const hsk_level = await hskLookup(hanzi);

  return data.map((row) => ({
    pinyin: toToneMarks(row.pinyin),
    meaning: row.english.split("/").filter(Boolean).join("; "),
    hsk_level,
    source: "cedict" as const,
  }));
}

export async function hskLookup(hanzi: string): Promise<number | null> {
  const { data } = await supabase
    .from("hsk_vocabulary")
    .select("level")
    .eq("hanzi", hanzi)
    .limit(1)
    .maybeSingle();

  return data ? Math.round(Number(data.level)) : null;
}

export interface SearchResult {
  hanzi: string;
  pinyin: string;
  meaning: string;
  hsk_level: number | null;
}

// Returns a large sorted pool — callers slice for pagination.
// Strip tone numbers and spaces: "hao3 chi1" → "haochi"
function flattenPinyin(pinyin: string): string {
  return pinyin.toLowerCase().replace(/[1-5]/g, "").replace(/\s+/g, "");
}

// Extract first pinyin syllable from a no-tone, no-space string like "haochi"
// Returns e.g. "hao" so we can use it as a DB prefix filter
function firstSyllable(normalized: string): string {
  // Ordered longest-first so "zh"/"ch"/"sh" beat "z"/"c"/"s"
  const initials = ["zh","ch","sh","b","p","m","f","d","t","n","l","g","k","h","j","q","x","r","z","c","s","y","w"];
  const finals   = ["iang","iong","uang","uan","ian","ang","eng","ing","ong","uai","iao","ai","ei","ui","ao","ou","iu","ie","er","an","en","in","un","ua","uo","ia","a","o","e","i","u","v"];
  const s = normalized.toLowerCase();
  for (const init of initials) {
    if (!s.startsWith(init)) continue;
    const rest = s.slice(init.length);
    for (const fin of finals) {
      if (rest.startsWith(fin)) return init + fin;
    }
  }
  // Null-initial syllables (a, e, o, ai, an, …)
  for (const fin of finals) {
    if (s.startsWith(fin)) return fin;
  }
  return s.slice(0, 4);
}

export async function cedictSearch(query: string): Promise<SearchResult[]> {
  if (!query.trim()) return [];

  const isAscii = /^[a-zA-Z0-9 ]+$/.test(query.trim());
  let rows: Array<{ simplified: string; pinyin: string; english: string }>;

  if (isAscii) {
    // Pleco-style: prefix match on tone-stripped, space-stripped pinyin.
    // "hao" → all entries starting with syllable hao (any tone).
    // "haochi" → entries whose normalized pinyin starts with "haochi".
    const normalized = flattenPinyin(query.trim()); // "hao3 chi1" or "haochi" → "haochi"
    const first = firstSyllable(normalized);         // "haochi" → "hao"

    // DB coarse filter: pinyin starts with first syllable (includes tones, e.g. "hao3 …")
    const { data } = await supabase
      .from("cedict")
      .select("simplified, pinyin, english")
      .ilike("pinyin", `${first}%`)
      .limit(1000);

    // Single syllable → exact match; multi-syllable → prefix match
    const isSingleSyllable = first === normalized;
    const seen = new Set<string>();
    rows = [];
    for (const row of data ?? []) {
      const key = row.simplified + "|" + row.pinyin;
      if (seen.has(key)) continue;
      const flat = flattenPinyin(row.pinyin);
      const matches = isSingleSyllable ? flat === normalized : flat.startsWith(normalized);
      if (matches) {
        seen.add(key);
        rows.push(row);
      }
    }
  } else {
    const q = query.trim();
    const pattern = q.length === 1 ? q : `${q}%`;
    const { data } = await supabase
      .from("cedict")
      .select("simplified, pinyin, english")
      .ilike("simplified", pattern)
      .limit(300);

    const seen = new Set<string>();
    rows = [];
    for (const row of data ?? []) {
      const key = row.simplified + "|" + row.pinyin;
      if (!seen.has(key)) {
        seen.add(key);
        rows.push(row);
      }
    }
  }

  if (rows.length === 0) return [];

  const { data: hskData } = await supabase
    .from("hsk_vocabulary")
    .select("hanzi, level")
    .in("hanzi", rows.map((r) => r.simplified));

  // Build hanzi → sorted levels (ascending). Multiple readings of same hanzi
  // get different levels; assign lowest to first CEDICT entry, next to second, etc.
  const hskLevels = new Map<string, number[]>();
  for (const row of hskData ?? []) {
    const level = Math.round(Number(row.level));
    const arr = hskLevels.get(row.hanzi) ?? [];
    arr.push(level);
    hskLevels.set(row.hanzi, arr);
  }
  for (const levels of hskLevels.values()) levels.sort((a, b) => a - b);
  const hskCursor = new Map<string, number>();

  const q = query.trim();
  return rows
    .map((row) => {
      const levels = hskLevels.get(row.simplified) ?? [];
      const idx = hskCursor.get(row.simplified) ?? 0;
      hskCursor.set(row.simplified, idx + 1);
      return {
        hanzi: row.simplified,
        pinyin: toToneMarks(row.pinyin),
        meaning: row.english.split("/").filter(Boolean).join("; "),
        hsk_level: levels[idx] ?? null,
      };
    })
    .sort((a, b) => {
      if (a.hanzi === q && b.hanzi !== q) return -1;
      if (b.hanzi === q && a.hanzi !== q) return 1;
      return a.hanzi.length - b.hanzi.length || a.hanzi.localeCompare(b.hanzi);
    });
}
