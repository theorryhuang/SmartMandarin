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
 */

export interface WordSense {
  pinyin: string;
  meaning: string;
  hsk_level?: number | null;
}

export interface WordDef {
  pinyin?: string;
  meaning?: string;
  hsk_level?: number | null;
  source?: string;
  senses?: WordSense[];
  already_saved?: boolean;
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

interface UseWordPopupOptions {
  masteryMap: Record<string, VocabularyMastery>;
  slangMode?: boolean;
  /** Caller's own "queued but not yet in masteryMap" tracking, if any. */
  isQueued?: (word: string) => boolean;
  onQueueChange?: (word: string, queued: boolean, def: WordDef | undefined) => void;
}

export function useWordPopup({ masteryMap, slangMode, isQueued: externalIsQueued, onQueueChange }: UseWordPopupOptions) {
  const router = useRouter();
  const [popup, setPopup] = useState<WordPopupState | null>(null);
  const cacheRef = useRef<Map<string, WordDef>>(new Map());
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

  const fetchDef = useCallback(
    async (word: string) => {
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
    },
    [slangMode]
  );

  const open = useCallback(
    (word: string, x: number, y: number, pinned: boolean, mastery: VocabularyMastery | undefined) => {
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
      fetchDef(word);
    },
    [alreadyQueued, fetchDef]
  );

  /** Desktop hover preview — no-ops while a popup is pinned open. */
  const showHover = useCallback(
    (word: string, rect: DOMRect, mastery: VocabularyMastery | undefined) => {
      if (pinnedWordRef.current) return;
      clearTimer();
      const x = rect.left + rect.width / 2;
      const y = rect.top;
      timerRef.current = window.setTimeout(() => open(word, x, y, false, mastery), 120);
    },
    [clearTimer, open]
  );

  const hideHover = useCallback(() => {
    if (pinnedWordRef.current) return;
    clearTimer();
    setPopup(null);
  }, [clearTimer]);

  /** Tap/click — sticky. Same word again closes it; a different word switches to it. */
  const toggleClick = useCallback(
    (word: string, x: number, y: number, mastery: VocabularyMastery | undefined) => {
      clearTimer();
      if (pinnedWordRef.current === word) {
        hide();
        return;
      }
      pinnedWordRef.current = word;
      open(word, x, y, true, mastery);
    },
    [clearTimer, hide, open]
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

  return { popup, popupRef, showHover, hideHover, toggleClick, toggleQueue, navigateToWord, hide };
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
