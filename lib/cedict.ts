/**
 * CEDICT lookup module — loads CC-CEDICT once, cached in module scope.
 * Server-side only (uses fs).
 */
import path from "path";

// Lazy-loaded singleton
let dictCache: ReturnType<typeof loadDict> | null = null;

function loadDict() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cedict = require("cedict-lookup");
  const filePath = path.join(process.cwd(), "data", "cedict.txt");
  return cedict.loadSimplified(filePath) as {
    getMatch: (word: string) => CedictEntry[];
  };
}

interface CedictEntry {
  traditional: string;
  simplified: string;
  pinyin: string; // numbered tones: "qing2 jie2"
  english: string; // slash-separated: "complex (psychology)/..."
}

function getDict() {
  if (!dictCache) dictCache = loadDict();
  return dictCache;
}

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

      // Find the vowel to mark (priority: a > e > ou > last vowel)
      const lower = base.toLowerCase();
      let result = base;

      if (lower.includes("a")) {
        result = base.replace(/a/i, (c) => toneMap[c === "A" ? "a" : "a"][tone] ?? c);
        // preserve case
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
        // Mark the last vowel (u, i, ü/v)
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
  source: "cedict" | "ai";
}

/**
 * Look up a simplified Chinese word/phrase in CEDICT.
 * Returns null if not found.
 */
export function cedictLookup(hanzi: string): DictResult | null {
  const dict = getDict();
  const entries = dict.getMatch(hanzi);
  if (!entries || entries.length === 0) return null;

  const entry = entries[0];
  const pinyin = toToneMarks(entry.pinyin);
  // CEDICT meanings are slash-separated; take first two for conciseness
  const meanings = entry.english
    .split("/")
    .filter(Boolean)
    .slice(0, 2)
    .join("; ");

  return { pinyin, meaning: meanings, source: "cedict" };
}
