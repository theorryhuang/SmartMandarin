"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { logMistake, removeFromReviewQueue } from "@/app/actions/vocabulary";
import { useLanguage } from "@/app/_components/LanguageContext";
import type { MasteryMap } from "@/lib/types";

/**
 * Shared click/hover word-definition popup — used by the story reader and
 * the chatbot. Interaction model:
 *  - Hover (desktop mouse only): transient preview, auto-hides on leave.
 *    Suppressed while a popup is pinned so it can't be knocked off-target.
 *  - Click/tap: pins the popup open. Clicking the same word again closes
 *    it; clicking a different word switches to it; clicking outside both
 *    the popup and any word token closes it.
 *  - Clicking the popup itself navigates to the full word page — never
 *    automatic, always an explicit second action.
 *
 * Callers hand in a *segmenter* word (the `Intl.Segmenter` span the hovered
 * char belongs to) plus that char's offset within it, not a pre-resolved
 * word — segmentation and CEDICT are different word lists, so a segmenter
 * span like "一步步" may not be a single CEDICT headword. When it isn't,
 * `/api/define-word` returns a `parts` breakdown (e.g. "一" + "步步"); this
 * hook resolves `offset` against those parts so each part is its own
 * independent hover/click target — its own popup, its own queue button —
 * not one card showing both stuck together. Resolution is cached per
 * segmenter word, so only the first touch of a given span costs a fetch.
 *
 * A resolved word can itself have multiple CEDICT senses — each is its own
 * independent review card (`vocabulary_mastery` is keyed by (hanzi, pinyin,
 * meaning) — pinyin alone isn't always enough, e.g. 打 dǎ covers "to hit",
 * "to make", "dozen", ... as distinct same-reading entries), so the popup
 * always renders a list of senses, each with its own add/remove button,
 * instead of forcing a single pick.
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

/** Raw shape returned by /api/define-word. */
export interface WordDef {
  pinyin?: string;
  meaning?: string;
  hsk_level?: number | null;
  source?: string;
  senses?: WordSense[];
  already_saved?: boolean;
  /** Only present transiently on the raw API response — resolved away into
   *  independent per-part lookups before anything reaches the UI. */
  parts?: WordPart[];
}

export interface WordPopupState {
  word: string;
  x: number;
  y: number;
  pinned: boolean;
  loading: boolean;
  /** Every known sense of `word` — from CEDICT plus any saved-but-uncatalogued
   *  ones — each independently addable/removable. Empty once resolved = nothing found. */
  senses: WordSense[];
  /** senseKey()s of `senses` that currently have a saved review card. */
  savedSenseKeys: Set<string>;
  source?: string;
}

/**
 * Identity for a sense: pinyin alone can collide (CEDICT sometimes lists
 * distinct senses under the same reading), so the meaning is part of the key.
 */
function senseKey(sense: { pinyin: string; meaning: string }): string {
  return sense.pinyin + "\u0001" + sense.meaning;
}

interface PendingResolve {
  segWord: string;
  offset: number;
  x: number;
  y: number;
  pinned: boolean;
}

interface UseWordPopupOptions {
  masteryMap: MasteryMap;
  slangMode?: boolean;
  onQueueChange?: (word: string, pinyin: string, queued: boolean, sense: WordSense) => void;
}

/** Which part of a decomposed segment covers `offset` (char index within the segment), and its char range? */
function partRangeAt(parts: WordPart[], offset: number): { word: string; start: number; end: number } | null {
  let acc = 0;
  for (const p of parts) {
    const len = Array.from(p.word).length;
    if (offset < acc + len) return { word: p.word, start: acc, end: acc + len };
    acc += len;
  }
  const last = parts[parts.length - 1];
  return last ? { word: last.word, start: acc - Array.from(last.word).length, end: acc } : null;
}

/** Merge the API's senses (or flat pinyin/meaning) with any saved rows CEDICT didn't mention (AI/slang defs). */
function normalizeSenses(def: WordDef, savedRows: { pinyin: string; meaning: string; hsk_level: number | null }[]): WordSense[] {
  const fromDef: WordSense[] =
    def.senses && def.senses.length > 0
      ? def.senses
      : def.pinyin || def.meaning
      ? [{ pinyin: def.pinyin ?? "", meaning: def.meaning ?? "", hsk_level: def.hsk_level ?? null }]
      : [];
  const seen = new Set(fromDef.map((s) => senseKey(s)));
  const extra = savedRows
    .filter((r) => !seen.has(senseKey(r)))
    .map((r) => ({ pinyin: r.pinyin, meaning: r.meaning, hsk_level: r.hsk_level }));
  return [...fromDef, ...extra];
}

export function useWordPopup({ masteryMap, slangMode, onQueueChange }: UseWordPopupOptions) {
  const router = useRouter();
  const [popup, setPopup] = useState<WordPopupState | null>(null);
  const cacheRef = useRef<Map<string, WordDef>>(new Map());
  // segWord -> its CEDICT-headword breakdown, or null if segWord is itself a headword.
  const decompRef = useRef<Map<string, WordPart[] | null>>(new Map());
  const inFlightRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<PendingResolve | null>(null);
  const timerRef = useRef<number | null>(null);
  const pinnedWordRef = useRef<string | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    pinnedWordRef.current = null;
    setPopup(null);
  }, [clearTimer]);

  /** Final step once a word is fully resolved (a real headword, no decomposition left). */
  const openResolved = useCallback(
    (word: string, x: number, y: number, pinned: boolean) => {
      const savedRows = masteryMap[word] ?? [];
      const savedSenseKeys = new Set(savedRows.map((r) => senseKey(r)));

      const cached = cacheRef.current.get(word);
      if (cached) {
        setPopup({ word, x, y, pinned, loading: false, senses: normalizeSenses(cached, savedRows), savedSenseKeys, source: cached.source });
        return;
      }

      // Instant partial view from whatever's already saved, while the full
      // CEDICT sense list (which might include more, unsaved senses) loads.
      const instant = savedRows.map((r) => ({ pinyin: r.pinyin, meaning: r.meaning, hsk_level: r.hsk_level }));
      setPopup({ word, x, y, pinned, loading: instant.length === 0, senses: instant, savedSenseKeys });

      (async () => {
        try {
          const res = await fetch("/api/define-word", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hanzi: word, slang_mode: slangMode }),
          });
          const def: WordDef = await res.json();
          cacheRef.current.set(word, def);
          setPopup((p) => (p && p.word === word ? { ...p, loading: false, senses: normalizeSenses(def, savedRows), source: def.source } : p));
        } catch {
          setPopup((p) => (p && p.word === word ? { ...p, loading: false } : p));
        }
      })();
    },
    [masteryMap, slangMode]
  );

  /** Fetches + caches the decomposition for a not-yet-seen segmenter word, then resolves whichever offset is current by the time it lands. */
  const fetchAndDecompose = useCallback(
    async (segWord: string) => {
      inFlightRef.current.add(segWord);
      try {
        const res = await fetch("/api/define-word", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hanzi: segWord, slang_mode: slangMode }),
        });
        const def: WordDef = await res.json();
        if (def.parts && def.parts.length > 0) {
          decompRef.current.set(segWord, def.parts);
          // Deliberately not caching individual parts here — each is
          // resolved (and its own senses fetched) lazily via openResolved
          // the moment it's actually hovered/clicked, so ambiguous parts
          // still get their own senses list instead of a flattened guess.
        } else {
          decompRef.current.set(segWord, null);
          if (def.pinyin || def.meaning || (def.senses?.length ?? 0) > 0) cacheRef.current.set(segWord, def);
        }
      } catch {
        decompRef.current.set(segWord, null); // don't retry forever on failure
      } finally {
        inFlightRef.current.delete(segWord);
      }

      const pending = pendingRef.current;
      if (!pending || pending.segWord !== segWord) return; // user moved on to something else entirely

      const parts = decompRef.current.get(segWord);
      const target = parts ? partRangeAt(parts, pending.offset)?.word ?? segWord : segWord;
      if (pending.pinned) pinnedWordRef.current = target;
      openResolved(target, pending.x, pending.y, pending.pinned);
    },
    [slangMode, openResolved]
  );

  /** Entry point: resolve a segmenter word + offset into its real headword, then open. */
  const resolveAndOpen = useCallback(
    (segWord: string, offset: number, x: number, y: number, pinned: boolean) => {
      pendingRef.current = { segWord, offset, x, y, pinned };

      if (decompRef.current.has(segWord)) {
        const parts = decompRef.current.get(segWord);
        const target = parts ? partRangeAt(parts, offset)?.word ?? segWord : segWord;
        if (pinned) pinnedWordRef.current = target;
        openResolved(target, x, y, pinned);
        return;
      }

      // Not seen before — show a loading placeholder immediately, resolve on arrival.
      setPopup({ word: segWord, x, y, pinned, loading: true, senses: [], savedSenseKeys: new Set() });
      if (!inFlightRef.current.has(segWord)) fetchAndDecompose(segWord);
    },
    [openResolved, fetchAndDecompose]
  );

  /** Desktop hover preview — no-ops while a popup is pinned open. */
  const showHover = useCallback(
    (segWord: string, offset: number, rect: DOMRect) => {
      if (pinnedWordRef.current) return;
      clearTimer();
      const x = rect.left + rect.width / 2;
      const y = rect.top;
      timerRef.current = window.setTimeout(() => resolveAndOpen(segWord, offset, x, y, false), 120);
    },
    [clearTimer, resolveAndOpen]
  );

  const hideHover = useCallback(() => {
    if (pinnedWordRef.current) return;
    clearTimer();
    setPopup(null);
  }, [clearTimer]);

  /**
   * Tap/click — sticky. Same word again closes it; a different word
   * switches to it. `exact: true` bypasses segment resolution entirely for
   * an explicit user selection (drag / native text-select) — that's a
   * literal override, honor exactly what was selected.
   */
  const toggleClick = useCallback(
    (segWord: string, offset: number, x: number, y: number, exact = false) => {
      clearTimer();

      if (exact) {
        if (pinnedWordRef.current === segWord) { hide(); return; }
        pinnedWordRef.current = segWord;
        openResolved(segWord, x, y, true);
        return;
      }

      if (decompRef.current.has(segWord)) {
        const parts = decompRef.current.get(segWord);
        const target = parts ? partRangeAt(parts, offset)?.word ?? segWord : segWord;
        if (pinnedWordRef.current === target) { hide(); return; }
        pinnedWordRef.current = target;
        openResolved(target, x, y, true);
        return;
      }

      pendingRef.current = { segWord, offset, x, y, pinned: true };
      pinnedWordRef.current = segWord; // placeholder — corrected once resolved
      setPopup({ word: segWord, x, y, pinned: true, loading: true, senses: [], savedSenseKeys: new Set() });
      if (!inFlightRef.current.has(segWord)) fetchAndDecompose(segWord);
    },
    [clearTimer, hide, openResolved, fetchAndDecompose]
  );

  /** Add/remove a review card for exactly one sense of the popup's word — leaves other senses untouched. */
  const toggleSense = useCallback(
    async (p: WordPopupState, sense: WordSense) => {
      const key = senseKey(sense);
      const nowSaved = !p.savedSenseKeys.has(key);
      setPopup((cur) => {
        if (!cur || cur.word !== p.word) return cur;
        const next = new Set(cur.savedSenseKeys);
        nowSaved ? next.add(key) : next.delete(key);
        return { ...cur, savedSenseKeys: next };
      });
      onQueueChange?.(p.word, sense.pinyin, nowSaved, sense);

      // Match on pinyin AND meaning — pinyin alone can collide between senses.
      const existingRow = (masteryMap[p.word] ?? []).find((r) => r.pinyin === sense.pinyin && r.meaning === sense.meaning);
      if (nowSaved) {
        await logMistake(existingRow?.id ?? p.word, {
          pinyin: sense.pinyin,
          meaning: sense.meaning,
          hsk_level: sense.hsk_level ?? undefined,
        }).catch(() => {});
      } else {
        await removeFromReviewQueue(existingRow?.id ?? p.word, sense.pinyin, sense.meaning).catch(() => {});
      }
    },
    [onQueueChange, masteryMap]
  );

  const navigateToWord = useCallback(
    (p: WordPopupState) => {
      hide();
      // Only pin a specific sense in the URL when there's exactly one — otherwise
      // let the word page itself show the full breakdown.
      const pinyin = p.senses.length === 1 ? p.senses[0].pinyin : undefined;
      router.push(`/vocab/word/${encodeURIComponent(p.word)}${pinyin ? `?pinyin=${encodeURIComponent(pinyin)}` : ""}`);
    },
    [hide, router]
  );

  /**
   * Sync, read-only lookup for renderers: given a segmenter span + offset,
   * what's the char range (local to the span) of the CEDICT headword that
   * actually covers it? Returns the whole span as one range until its
   * decomposition has been fetched at least once (matches pre-resolution
   * display) — so highlight-under-cursor tracks the real resolved word,
   * e.g. only "步步" lights up, not the full "一步步" segment.
   */
  const resolveRange = useCallback((segWord: string, offset: number): { start: number; end: number } => {
    const parts = decompRef.current.get(segWord);
    if (!parts) return { start: 0, end: Array.from(segWord).length };
    return partRangeAt(parts, offset) ?? { start: 0, end: Array.from(segWord).length };
  }, []);

  // Dismiss a pinned popup on any click outside it. Word tokens are excluded
  // (via [data-word-token]) since they manage their own pin/unpin already.
  useEffect(() => {
    function onDocPointerDown(e: PointerEvent) {
      if (!pinnedWordRef.current) return;
      const target = e.target as HTMLElement;
      if (popupRef.current?.contains(target)) return;
      if (target.closest("[data-word-token]")) return;
      hide();
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [hide]);

  return { popup, popupRef, showHover, hideHover, toggleClick, toggleSense, navigateToWord, hide, resolveRange };
}

export function WordPopupCard({
  popup,
  popupRef,
  onNavigate,
  onToggleSense,
}: {
  popup: WordPopupState;
  popupRef: React.RefObject<HTMLDivElement | null>;
  onNavigate: () => void;
  onToggleSense: (sense: WordSense) => void;
}) {
  const { t } = useLanguage();

  return (
    <div
      ref={popupRef}
      onClick={onNavigate}
      className="fixed z-[60] px-3 py-2 rounded-xl bg-neutral-900 text-white shadow-xl border border-white/10 max-w-[260px] cursor-pointer select-none"
      style={{
        left: popup.x,
        top: popup.y < 90 ? popup.y + 26 : popup.y - 10,
        transform: popup.y < 90 ? "translate(-50%, 0)" : "translate(-50%, -100%)",
      }}
    >
      <div className="text-sm font-medium leading-tight mb-1">{popup.word}</div>

      {popup.loading && popup.senses.length === 0 ? (
        <div className="text-xs text-white/50">…</div>
      ) : popup.senses.length === 0 ? (
        <div className="text-xs text-white/50 italic">{t.notInVocab}</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {popup.senses.map((sense, i) => {
            const saved = popup.savedSenseKeys.has(senseKey(sense));
            return (
              <div key={i} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {sense.pinyin && <div className="text-xs text-violet-300">{sense.pinyin}</div>}
                  <div className="text-xs text-white/90">{sense.meaning}</div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSense(sense);
                  }}
                  title={saved ? t.removeFromReview : t.queueForReview}
                  className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold leading-none transition-colors ${
                    saved ? "bg-red-500/90 hover:bg-red-500" : "bg-violet-500/90 hover:bg-violet-500"
                  }`}
                >
                  {saved ? "–" : "+"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {popup.source === "ai" && (
        <div className="text-[10px] text-amber-400/80 mt-1.5">{t.aiDefinitionWarning}</div>
      )}
    </div>
  );
}
