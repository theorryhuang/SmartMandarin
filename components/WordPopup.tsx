"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { logMistake, removeFromReviewQueue } from "@/app/actions/vocabulary";
import { useLanguage } from "@/app/_components/LanguageContext";
import type { VocabularyMastery } from "@/lib/types";

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
  def?: WordDef;
  queued: boolean;
  mastery?: VocabularyMastery;
}

interface PendingResolve {
  segWord: string;
  offset: number;
  x: number;
  y: number;
  pinned: boolean;
}

interface UseWordPopupOptions {
  masteryMap: Record<string, VocabularyMastery>;
  slangMode?: boolean;
  /** Caller's own "queued but not yet in masteryMap" tracking, if any. */
  isQueued?: (word: string) => boolean;
  onQueueChange?: (word: string, queued: boolean, def: WordDef | undefined) => void;
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

export function useWordPopup({ masteryMap, slangMode, isQueued: externalIsQueued, onQueueChange }: UseWordPopupOptions) {
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

  const alreadyQueued = useCallback(
    (word: string) => !!masteryMap[word] || (externalIsQueued?.(word) ?? false),
    [masteryMap, externalIsQueued]
  );

  /** Final step once a word is fully resolved (a real headword, no decomposition left). */
  const openResolved = useCallback(
    (word: string, x: number, y: number, pinned: boolean) => {
      const mastery = masteryMap[word];
      const queued = alreadyQueued(word);
      if (mastery?.meaning) {
        setPopup({ word, x, y, pinned, loading: false, def: { pinyin: mastery.pinyin, meaning: mastery.meaning, hsk_level: mastery.hsk_level }, queued, mastery });
        return;
      }
      const cached = cacheRef.current.get(word);
      if (cached) {
        setPopup({ word, x, y, pinned, loading: false, def: cached, queued: queued || !!cached.already_saved, mastery });
        return;
      }
      setPopup({ word, x, y, pinned, loading: true, queued, mastery });
      (async () => {
        try {
          const res = await fetch("/api/define-word", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hanzi: word, slang_mode: slangMode }),
          });
          const def: WordDef = await res.json();
          if (def.pinyin || def.meaning) {
            cacheRef.current.set(word, def);
            setPopup((p) => (p && p.word === word ? { ...p, loading: false, def, queued: p.queued || !!def.already_saved } : p));
          } else {
            setPopup((p) => (p && p.word === word ? { ...p, loading: false } : p));
          }
        } catch {
          setPopup((p) => (p && p.word === word ? { ...p, loading: false } : p));
        }
      })();
    },
    [masteryMap, alreadyQueued, slangMode]
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
          for (const part of def.parts) {
            if (!cacheRef.current.has(part.word)) {
              cacheRef.current.set(part.word, { pinyin: part.pinyin, meaning: part.meaning, hsk_level: part.hsk_level, source: "cedict" });
            }
          }
        } else {
          decompRef.current.set(segWord, null);
          if (def.pinyin || def.meaning) cacheRef.current.set(segWord, def);
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
      setPopup({ word: segWord, x, y, pinned, loading: true, queued: false });
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
      setPopup({ word: segWord, x, y, pinned: true, loading: true, queued: false });
      if (!inFlightRef.current.has(segWord)) fetchAndDecompose(segWord);
    },
    [clearTimer, hide, openResolved, fetchAndDecompose]
  );

  const toggleQueue = useCallback(
    async (p: WordPopupState) => {
      const nextQueued = !p.queued;
      setPopup((cur) => (cur && cur.word === p.word ? { ...cur, queued: nextQueued } : cur));
      onQueueChange?.(p.word, nextQueued, p.def);
      if (nextQueued) {
        await logMistake(p.mastery?.id ?? p.word, {
          pinyin: p.mastery?.pinyin ?? p.def?.pinyin,
          meaning: p.mastery?.meaning ?? p.def?.meaning,
          hsk_level: p.mastery?.hsk_level ?? p.def?.hsk_level ?? undefined,
        }).catch(() => {});
      } else {
        await removeFromReviewQueue(p.mastery?.id ?? p.word).catch(() => {});
      }
    },
    [onQueueChange]
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

  const navigateToWord = useCallback(
    (p: WordPopupState) => {
      hide();
      const pinyin = p.def?.pinyin || p.mastery?.pinyin;
      router.push(`/vocab/word/${encodeURIComponent(p.word)}${pinyin ? `?pinyin=${encodeURIComponent(pinyin)}` : ""}`);
    },
    [hide, router]
  );

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

  return { popup, popupRef, showHover, hideHover, toggleClick, toggleQueue, navigateToWord, hide, resolveRange };
}

export function WordPopupCard({
  popup,
  popupRef,
  onNavigate,
  onToggleQueue,
}: {
  popup: WordPopupState;
  popupRef: React.RefObject<HTMLDivElement | null>;
  onNavigate: () => void;
  onToggleQueue: () => void;
}) {
  const { t } = useLanguage();
  const ambiguous = (popup.def?.senses?.length ?? 0) > 1;
  const canQueue = !popup.loading && !ambiguous && !!popup.def?.meaning;

  return (
    <div
      ref={popupRef}
      onClick={onNavigate}
      className="fixed z-[60] px-3 py-2 rounded-xl bg-neutral-900 text-white shadow-xl border border-white/10 max-w-[240px] cursor-pointer select-none"
      style={{
        left: popup.x,
        top: popup.y < 90 ? popup.y + 26 : popup.y - 10,
        transform: popup.y < 90 ? "translate(-50%, 0)" : "translate(-50%, -100%)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium leading-tight">{popup.word}</div>
        {canQueue && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleQueue();
            }}
            title={popup.queued ? t.removeFromReview : t.queueForReview}
            className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold leading-none transition-colors ${
              popup.queued ? "bg-red-500/90 hover:bg-red-500" : "bg-violet-500/90 hover:bg-violet-500"
            }`}
          >
            {popup.queued ? "–" : "+"}
          </button>
        )}
      </div>

      {popup.loading ? (
        <div className="text-xs text-white/50 mt-0.5">…</div>
      ) : ambiguous ? (
        <div className="text-xs text-amber-300 mt-0.5">{t.multipleSenses}</div>
      ) : popup.def?.meaning ? (
        <>
          {popup.def.pinyin && <div className="text-xs text-violet-300 mt-0.5">{popup.def.pinyin}</div>}
          <div className="text-xs text-white/90 mt-0.5">{popup.def.meaning}</div>
          {popup.def.source === "ai" && (
            <div className="text-[10px] text-amber-400/80 mt-1">{t.aiDefinitionWarning}</div>
          )}
        </>
      ) : (
        <div className="text-xs text-white/50 italic mt-0.5">{t.notInVocab}</div>
      )}
    </div>
  );
}
