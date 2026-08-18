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
  source: "cedict";
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
  // 68 hanzi have more than one row here (e.g. 好 is both 1.0 and 5.0 —
  // different senses classified differently across HSK list versions this
  // table was merged from). Without an explicit order, .limit(1) handed
  // back whichever row Postgres felt like on a given query plan — not
  // reliably reproducible. Ordering ascending makes it deterministic and
  // picks the more fundamental/common classification for an ambiguous word.
  const { data } = await supabase
    .from("hsk_vocabulary")
    .select("level")
    .eq("hanzi", hanzi)
    .order("level", { ascending: true })
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

const PINYIN_INITIALS = ["zh","ch","sh","b","p","m","f","d","t","n","l","g","k","h","j","q","x","r","z","c","s","y","w"];
const PINYIN_FINALS   = ["iang","iong","uang","uan","ian","ang","eng","ing","ong","uai","iao","ai","ei","ui","ao","ou","iu","ie","er","an","en","in","un","ua","uo","ia","a","o","e","i","u","v"];

function firstSyllable(s: string): string {
  const lower = s.toLowerCase();
  for (const init of PINYIN_INITIALS) {
    if (!lower.startsWith(init)) continue;
    const rest = lower.slice(init.length);
    for (const fin of PINYIN_FINALS) {
      if (rest.startsWith(fin)) return init + fin;
    }
  }
  for (const fin of PINYIN_FINALS) {
    if (lower.startsWith(fin)) return fin;
  }
  return lower.slice(0, 4);
}

// Segment full normalized pinyin string into syllables: "qisi" → ["qi","si"]
function segmentPinyin(normalized: string): string[] {
  const syllables: string[] = [];
  let s = normalized.toLowerCase();
  while (s.length > 0) {
    const syl = firstSyllable(s);
    syllables.push(syl);
    s = s.slice(syl.length);
    if (syl.length === 0) break;
  }
  return syllables;
}

// Build targeted DB ilike pattern from syllables.
// Single:  ["hao"]      → "hao_"      (tone wildcard, exact syllable)
// Multi:   ["qi","si"]  → "qi_ si%"   (each internal syllable exact, suffix open)
function buildPinyinPattern(syllables: string[]): string {
  if (syllables.length === 0) return "%";
  if (syllables.length === 1) return syllables[0] + "_";
  return syllables.slice(0, -1).map(s => s + "_ ").join("") + syllables.at(-1) + "%";
}

async function greedySegment(
  q: string,
  seen: Set<string>
): Promise<Array<{ simplified: string; pinyin: string; english: string }>> {
  const chars = [...q];

  // Round 1: find which substrings are themselves an exact cedict entry (one query)
  const allSubs = new Set<string>();
  for (let i = 0; i < chars.length; i++)
    for (let j = i + 1; j <= chars.length; j++)
      allSubs.add(chars.slice(i, j).join(""));

  const { data: existing } = await supabase.from("cedict")
    .select("simplified")
    .in("simplified", [...allSubs]);

  // Which substrings are themselves an actual cedict entry (not just a prefix
  // of some longer one — a segment must be a real word, or Round 2's lookup
  // only surfaces longer compounds and the segment's own definition never
  // shows up).
  const validWords = new Set<string>();
  for (const sub of allSubs) {
    if ((existing ?? []).some(r => r.simplified === sub))
      validWords.add(sub);
  }

  // Greedy longest-match using real word existence, falling back to a lone
  // character when nothing at this position matches any dictionary entry
  // (so every character still gets looked up instead of being dropped).
  // Run in BOTH directions and union the result — a single left-to-right
  // pass picks one parse and can silently hide a valid alternative (e.g.
  // "耀华中学" forward-greedy reads as 耀+华中+学, missing that 华+中学 is
  // the actually-intended split); backward-from-the-right catches what
  // forward missed and vice versa, so both show up as candidates instead of
  // one being dropped. No extra query — reuses the validWords set above.
  function walk(forward: boolean): string[] {
    const out: string[] = [];
    let i = forward ? 0 : chars.length;
    while (forward ? i < chars.length : i > 0) {
      let matched = false;
      const remaining = forward ? chars.length - i : i;
      for (let len = remaining; len >= 1; len--) {
        const start = forward ? i : i - len;
        const sub = chars.slice(start, start + len).join("");
        if (validWords.has(sub)) {
          out.push(sub);
          i = forward ? i + len : i - len;
          matched = true;
          break;
        }
      }
      if (!matched) {
        const start = forward ? i : i - 1;
        out.push(chars[start]);
        i = forward ? i + 1 : i - 1;
      }
    }
    return forward ? out : out.reverse();
  }

  const segments = [...new Set([...walk(true), ...walk(false)])];
  if (segments.length === 0) return [];

  // Round 2: fetch prefix results for each segment in parallel
  const rows: Array<{ simplified: string; pinyin: string; english: string }> = [];
  const results = await Promise.all(
    segments.map(seg =>
      supabase.from("cedict").select("simplified, pinyin, english")
        .ilike("simplified", seg.length === 1 ? seg : `${seg}%`)
        .limit(seg.length === 1 ? 10 : 50)
    )
  );
  for (const { data } of results) {
    for (const row of data ?? []) {
      const key = row.simplified + "|" + row.pinyin;
      if (!seen.has(key)) { seen.add(key); rows.push(row); }
    }
  }
  return rows;
}

async function buildResults(
  rows: Array<{ simplified: string; pinyin: string; english: string }>,
  q: string
): Promise<SearchResult[]> {
  if (rows.length === 0) return [];

  const { data: hskData } = await supabase
    .from("hsk_vocabulary")
    .select("hanzi, level")
    .in("hanzi", rows.map((r) => r.simplified));

  const hskLevels = new Map<string, number[]>();
  for (const row of hskData ?? []) {
    const level = Math.round(Number(row.level));
    const arr = hskLevels.get(row.hanzi) ?? [];
    arr.push(level);
    hskLevels.set(row.hanzi, arr);
  }
  for (const levels of hskLevels.values()) levels.sort((a, b) => a - b);
  const hskCursor = new Map<string, number>();

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
      // Primary: position of entry's first char in query (preserves segment order)
      const aSegIdx = q.indexOf(a.hanzi[0]);
      const bSegIdx = q.indexOf(b.hanzi[0]);
      if (aSegIdx !== bSegIdx) return aSegIdx - bSegIdx;
      // Within same segment: shorter first
      const lenDiff = a.hanzi.length - b.hanzi.length;
      if (lenDiff !== 0) return lenDiff;
      return a.hanzi.localeCompare(b.hanzi);
    });
}

function isChinese(c: string): boolean {
  return /[一-鿿㐀-䶿]/.test(c);
}

// Detect mixed input like "奇ji": leading Chinese chars + trailing ASCII pinyin
function parseMixed(query: string): { hanziPrefix: string; pinyinSuffix: string } | null {
  let i = 0;
  while (i < query.length && isChinese(query[i])) i++;
  if (i === 0 || i === query.length) return null;
  const rest = query.slice(i);
  if (!/^[a-zA-Z]/.test(rest)) return null;
  return { hanziPrefix: query.slice(0, i), pinyinSuffix: rest.toLowerCase() };
}

export async function cedictSearch(query: string, mode: "chinese" | "english" = "chinese"): Promise<SearchResult[]> {
  if (!query.trim()) return [];

  if (mode === "english") {
    const { data } = await supabase
      .from("cedict")
      .select("simplified, pinyin, english")
      .ilike("english", `%${query.trim()}%`)
      .limit(1000);

    const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const wordRe = new RegExp(`\\b${escaped}\\b`, "i");
    const seen = new Set<string>();
    const rows: Array<{ simplified: string; pinyin: string; english: string }> = [];
    for (const row of data ?? []) {
      if (!wordRe.test(row.english)) continue;
      const key = row.simplified + "|" + row.pinyin;
      if (!seen.has(key)) { seen.add(key); rows.push(row); }
    }
    return buildResults(rows, query.trim());
  }

  const isAscii = /^[a-zA-Z0-9 ]+$/.test(query.trim());
  const mixed = !isAscii ? parseMixed(query.trim()) : null;
  let rows: Array<{ simplified: string; pinyin: string; english: string }>;

  if (isAscii) {
    const normalized = flattenPinyin(query.trim());
    const syllables = segmentPinyin(normalized);
    const isSingleSyllable = syllables.length === 1 && syllables[0] === normalized;
    const pattern = buildPinyinPattern(syllables);

    const { data: byPinyin } = await supabase
      .from("cedict").select("simplified, pinyin, english")
      .ilike("pinyin", pattern)
      .limit(1000);

    const seen = new Set<string>();
    rows = [];
    for (const row of byPinyin ?? []) {
      const key = row.simplified + "|" + row.pinyin;
      if (seen.has(key)) continue;
      const flat = flattenPinyin(row.pinyin);
      if (isSingleSyllable ? flat === normalized : flat.startsWith(normalized)) {
        seen.add(key);
        rows.push(row);
      }
    }
  } else if (mixed) {
    // Mixed input like "奇ji": simplified prefix match + pinyin suffix prefix match
    const { hanziPrefix, pinyinSuffix } = mixed;
    const normalizedSuffix = flattenPinyin(pinyinSuffix);
    const hanziLen = [...hanziPrefix].length; // chars = pinyin syllables to skip

    const { data } = await supabase
      .from("cedict")
      .select("simplified, pinyin, english")
      .ilike("simplified", `${hanziPrefix}%`)
      .limit(500);

    const seen = new Set<string>();
    rows = [];
    for (const row of data ?? []) {
      const key = row.simplified + "|" + row.pinyin;
      if (seen.has(key)) continue;
      const remainingPinyin = row.pinyin.split(" ").slice(hanziLen).join(" ");
      if (flattenPinyin(remainingPinyin).startsWith(normalizedSuffix)) {
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

    // No prefix match → greedy longest-match segmentation (Pleco-style)
    if (rows.length === 0 && q.length > 1) {
      rows = await greedySegment(q, seen);
    }
  }

  return buildResults(rows, query.trim());
}
