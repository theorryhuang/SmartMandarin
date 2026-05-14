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
