/**
 * Client-safe Chinese word segmentation. Uses the browser's built-in
 * `Intl.Segmenter` (ICU dictionary-based word breaking) so hover/tap
 * targets are whole words ("北京" / "学习") instead of single characters.
 * Falls back to one "word" per character where `Intl.Segmenter` is
 * unavailable (old Safari, some SSR contexts).
 */

const HANZI_RE = /[一-鿿㐀-䶿]/;

export interface WordSegment {
  word: string;
  start: number; // inclusive, code-point index into Array.from(text)
  end: number; // exclusive
  isWordLike: boolean;
}

let cachedSegmenter: Intl.Segmenter | null | undefined;

function getSegmenter(): Intl.Segmenter | null {
  if (cachedSegmenter !== undefined) return cachedSegmenter;
  try {
    cachedSegmenter =
      typeof Intl !== "undefined" && "Segmenter" in Intl
        ? new Intl.Segmenter("zh", { granularity: "word" })
        : null;
  } catch {
    cachedSegmenter = null;
  }
  return cachedSegmenter;
}

/** Segments `text` (hanzi mixed with punctuation/latin is fine) into words. */
export function segmentIntoWords(text: string): WordSegment[] {
  const chars = Array.from(text);
  const seg = getSegmenter();
  if (!seg) {
    return chars.map((c, i) => ({ word: c, start: i, end: i + 1, isWordLike: HANZI_RE.test(c) }));
  }

  const segments: WordSegment[] = [];
  let idx = 0;
  for (const { segment, isWordLike } of seg.segment(text)) {
    const len = Array.from(segment).length;
    segments.push({ word: segment, start: idx, end: idx + len, isWordLike: !!isWordLike });
    idx += len;
  }

  // Defensive: Intl.Segmenter should account for every code point, but if it
  // ever doesn't, fall back to per-char so indices stay aligned with `chars`.
  if (idx !== chars.length) {
    return chars.map((c, i) => ({ word: c, start: i, end: i + 1, isWordLike: HANZI_RE.test(c) }));
  }
  return segments;
}

/** char-index → segment-index, for O(1) "which word is under this char" lookups. */
export function charSegmentIndex(segments: WordSegment[]): number[] {
  const map: number[] = [];
  segments.forEach((seg, si) => {
    for (let i = seg.start; i < seg.end; i++) map[i] = si;
  });
  return map;
}
