"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  /** Every CEDICT sense for this part, when it has more than one (e.g. 乘
   *  as Chéng/chéng/shèng) — same shape as the server's lib/defineWord.ts. */
  senses?: WordSense[];
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

/** One row of a decomposed breakdown (word isn't itself a CEDICT headword,
 *  but splits into real ones) — same shape as the extension's part rows,
 *  each independently viewable and addable. */
export interface DecomposedPart {
  word: string;
  senses: WordSense[];
  savedSenseKeys: Set<string>;
}

export interface WordPopupState {
  word: string;
  x: number;
  y: number;
  pinned: boolean;
  loading: boolean;
  /** Every known sense of `word` — from CEDICT plus any saved-but-uncatalogued
   *  ones — each independently addable/removable. Empty once resolved = nothing found.
   *  Unused (empty) when `parts` is set instead. */
  senses: WordSense[];
  /** senseKey()s of `senses` that currently have a saved review card. */
  savedSenseKeys: Set<string>;
  source?: string;
  /** Set instead of `senses` when `word` isn't itself a CEDICT headword but
   *  decomposes into real ones (e.g. a raw multi-char drag-selection) — the
   *  same breakdown the browser extension's popup shows, each part its own
   *  independently viewable/addable row rather than one merged, garbled row. */
  parts?: DecomposedPart[];
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

/** Merge the API's senses (or flat pinyin/meaning) with any saved rows CEDICT
 *  didn't mention (AI/slang defs). Takes either a whole WordDef or a single
 *  WordPart — both share this pinyin/meaning/hsk_level/senses shape, so the
 *  same merge logic covers a resolved word and one row of a decomposed one. */
function normalizeSenses(
  def: { pinyin?: string; meaning?: string; hsk_level?: number | null; senses?: WordSense[] },
  savedRows: { pinyin: string; meaning: string; hsk_level: number | null }[]
): WordSense[] {
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

/**
 * Add/remove one saved-word row. A plain `fetch(..., { keepalive: true })`
 * to a Route Handler instead of a `"use server"` action — the toggle button
 * updates its UI optimistically and doesn't await this before returning
 * control to the user, who's then free to navigate away (or, on mobile,
 * background the tab) an instant later. A Server Action call is just a
 * fetch with no unload protection, so the browser can kill it mid-flight —
 * the popup shows "saved", but the write never lands, and the word quietly
 * reverts to unsaved next time masteryMap loads. `keepalive` is the
 * browser-standard fix: it guarantees the request is still sent even if the
 * page that started it is gone before the response would arrive.
 */
export async function persistVocabToggle(
  action: "add" | "remove",
  word: string,
  sense: { pinyin: string; meaning: string; hsk_level?: number | null },
  existingId?: string
): Promise<boolean> {
  try {
    const res = await fetch("/api/vocab/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        action,
        id: existingId,
        hanzi: word,
        pinyin: sense.pinyin,
        meaning: sense.meaning,
        hsk_level: sense.hsk_level ?? null,
      }),
    });
    return res.ok;
  } catch {
    // Killed mid-flight (page gone) or a real network failure — either way
    // the caller needs to know it didn't land so it can undo its optimistic
    // UI update instead of quietly lying about what's actually saved.
    return false;
  }
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
  // word -> senseKey -> saved/unsaved, for toggles made *this* session.
  // `masteryMap` only refreshes on a full page (re)load (see ConversationClient's
  // router.refresh()-on-mount comment), so a save made, then the popup closed
  // and the same word clicked again, would otherwise read straight back off
  // the stale masteryMap and show "+" again for a word you just saved — this
  // overlay is what makes toggles stick for the rest of the session regardless
  // of how many times the popup for that word is closed and reopened.
  const sessionOverridesRef = useRef<Map<string, Map<string, boolean>>>(new Map());

  const applyOverrides = useCallback((word: string, keys: Set<string>): Set<string> => {
    const overrides = sessionOverridesRef.current.get(word);
    if (!overrides) return keys;
    const next = new Set(keys);
    for (const [key, saved] of overrides) {
      if (saved) next.add(key);
      else next.delete(key);
    }
    return next;
  }, []);

  const recordOverride = useCallback((word: string, key: string, saved: boolean) => {
    let overrides = sessionOverridesRef.current.get(word);
    if (!overrides) {
      overrides = new Map();
      sessionOverridesRef.current.set(word, overrides);
    }
    overrides.set(key, saved);
  }, []);

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

  // Same breakdown the extension shows — one row per real CEDICT word inside
  // a span that isn't itself a headword, each with its own saved-state
  // pulled from masteryMap under *that part's own* hanzi, not the whole span's.
  const buildParts = useCallback(
    (def: WordDef): DecomposedPart[] =>
      (def.parts ?? []).map((part) => {
        const savedRows = masteryMap[part.word] ?? [];
        return {
          word: part.word,
          senses: normalizeSenses(part, savedRows),
          savedSenseKeys: applyOverrides(part.word, new Set(savedRows.map((r) => senseKey(r)))),
        };
      }),
    [masteryMap, applyOverrides]
  );

  /** Final step once a word is fully resolved (a real headword, no decomposition left). */
  const openResolved = useCallback(
    (word: string, x: number, y: number, pinned: boolean) => {
      const savedRows = masteryMap[word] ?? [];
      const savedSenseKeys = applyOverrides(word, new Set(savedRows.map((r) => senseKey(r))));

      const cached = cacheRef.current.get(word);
      if (cached) {
        const parts = cached.parts && cached.parts.length > 0 ? buildParts(cached) : undefined;
        setPopup({
          word, x, y, pinned, loading: false,
          senses: parts ? [] : normalizeSenses(cached, savedRows),
          savedSenseKeys, source: cached.source, parts,
        });
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
          const parts = def.parts && def.parts.length > 0 ? buildParts(def) : undefined;
          setPopup((p) => (p && p.word === word ? {
            ...p, loading: false,
            senses: parts ? [] : normalizeSenses(def, savedRows),
            source: def.source, parts,
          } : p));
        } catch {
          setPopup((p) => (p && p.word === word ? { ...p, loading: false } : p));
        }
      })();
    },
    [masteryMap, slangMode, buildParts, applyOverrides]
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
      recordOverride(p.word, key, nowSaved);
      setPopup((cur) => {
        if (!cur || cur.word !== p.word) return cur;
        const next = new Set(cur.savedSenseKeys);
        nowSaved ? next.add(key) : next.delete(key);
        return { ...cur, savedSenseKeys: next };
      });
      onQueueChange?.(p.word, sense.pinyin, nowSaved, sense);

      // Match on pinyin AND meaning — pinyin alone can collide between senses.
      const existingRow = (masteryMap[p.word] ?? []).find((r) => r.pinyin === sense.pinyin && r.meaning === sense.meaning);
      // Unsaving means "remove this word from my vocab list", not just clear
      // flagged_for_immediate_use (that only controls forced re-injection
      // into the next AI turn and would leave the word — and its "saved"
      // state on the next load — untouched).
      const ok = await persistVocabToggle(nowSaved ? "add" : "remove", p.word, sense, existingRow?.id);
      if (!ok) {
        // The write didn't actually land — undo the optimistic flip instead
        // of leaving the UI claiming a state the database doesn't have.
        // This is the gap the extension doesn't have: it only ever touches
        // its local cache *after* the server confirms, so it can't drift.
        recordOverride(p.word, key, !nowSaved);
        setPopup((cur) => {
          if (!cur || cur.word !== p.word) return cur;
          const next = new Set(cur.savedSenseKeys);
          nowSaved ? next.delete(key) : next.add(key);
          return { ...cur, savedSenseKeys: next };
        });
        onQueueChange?.(p.word, sense.pinyin, !nowSaved, sense);
        return;
      }
      // Confirmed — pull a fresh masteryMap so the *next* popup open (this
      // session or not) reads real server state instead of leaning on the
      // in-memory override forever. Same role as the extension's own
      // savedWords cache staying in lockstep with every confirmed write.
      router.refresh();
    },
    [onQueueChange, masteryMap, recordOverride, router]
  );

  /** Add/remove a review card for one sense of one part of a decomposed
   *  breakdown — mirrors toggleSense but attributes the save to that part's
   *  own hanzi, not the popup's overall (non-headword) `word`. */
  const togglePartSense = useCallback(
    async (p: WordPopupState, part: DecomposedPart, sense: WordSense) => {
      const key = senseKey(sense);
      const nowSaved = !part.savedSenseKeys.has(key);
      recordOverride(part.word, key, nowSaved);
      setPopup((cur) => {
        if (!cur || cur.word !== p.word || !cur.parts) return cur;
        return {
          ...cur,
          parts: cur.parts.map((pt) => {
            if (pt.word !== part.word) return pt;
            const next = new Set(pt.savedSenseKeys);
            nowSaved ? next.add(key) : next.delete(key);
            return { ...pt, savedSenseKeys: next };
          }),
        };
      });
      onQueueChange?.(part.word, sense.pinyin, nowSaved, sense);

      const existingRow = (masteryMap[part.word] ?? []).find((r) => r.pinyin === sense.pinyin && r.meaning === sense.meaning);
      const ok = await persistVocabToggle(nowSaved ? "add" : "remove", part.word, sense, existingRow?.id);
      if (!ok) {
        // Same revert as toggleSense above — don't leave the UI claiming a
        // save that didn't actually land.
        recordOverride(part.word, key, !nowSaved);
        setPopup((cur) => {
          if (!cur || cur.word !== p.word || !cur.parts) return cur;
          return {
            ...cur,
            parts: cur.parts.map((pt) => {
              if (pt.word !== part.word) return pt;
              const next = new Set(pt.savedSenseKeys);
              nowSaved ? next.delete(key) : next.add(key);
              return { ...pt, savedSenseKeys: next };
            }),
          };
        });
        onQueueChange?.(part.word, sense.pinyin, !nowSaved, sense);
        return;
      }
      router.refresh();
    },
    [onQueueChange, masteryMap, recordOverride, router]
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

  /** Navigate to one part's own word page (not the whole decomposed span). */
  const navigateToPart = useCallback(
    (word: string, pinyin?: string) => {
      hide();
      router.push(`/vocab/word/${encodeURIComponent(word)}${pinyin ? `?pinyin=${encodeURIComponent(pinyin)}` : ""}`);
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

  return { popup, popupRef, showHover, hideHover, toggleClick, toggleSense, togglePartSense, navigateToWord, navigateToPart, hide, resolveRange };
}

export function WordPopupCard({
  popup,
  popupRef,
  onNavigate,
  onToggleSense,
  onNavigatePart,
  onTogglePartSense,
}: {
  popup: WordPopupState;
  popupRef: React.RefObject<HTMLDivElement | null>;
  onNavigate: () => void;
  onToggleSense: (sense: WordSense) => void;
  /** Required when popup.parts is set — navigate to one part's own page. */
  onNavigatePart?: (word: string, pinyin?: string) => void;
  /** Required when popup.parts is set — toggle one sense of one part. */
  onTogglePartSense?: (part: DecomposedPart, sense: WordSense) => void;
}) {
  const { t } = useLanguage();
  const below = popup.y < 90;

  // Drag-to-move, same model as the extension's popup: once dragged past a
  // small threshold, drop the anchor-centered transform for plain top-left
  // tracking and never let the position effect below touch it again — a
  // fresh popup (new `popup.word`/`popup.x`/`popup.y`) resets this.
  const draggedRef = useRef(false);
  const dragStateRef = useRef<{ startX: number; startY: number; baseLeft: number; baseTop: number } | null>(null);
  useEffect(() => {
    draggedRef.current = false;
  }, [popup.word, popup.x, popup.y]);

  // Anchor is a single point (the hovered/clicked char); the card is
  // centered under/over it via translate(-50%, …). Runs after every commit
  // (no dep array) since React re-applies the raw, unclamped left/top from
  // the style prop on every render — reasserting the clamp only when deps
  // happened to change would let it get clobbered by unrelated re-renders.
  // Skipped entirely once dragged — that position is now fully manual.
  useLayoutEffect(() => {
    if (draggedRef.current) return;
    const el = popupRef.current;
    if (!el) return;
    const margin = 8;
    const rect = el.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (rect.left < margin) dx = margin - rect.left;
    else if (rect.right > window.innerWidth - margin) dx = window.innerWidth - margin - rect.right;
    if (rect.top < margin) dy = margin - rect.top;
    else if (rect.bottom > window.innerHeight - margin) dy = window.innerHeight - margin - rect.bottom;
    if (dx) el.style.left = `${popup.x + dx}px`;
    if (dy) el.style.top = `${(below ? popup.y + 26 : popup.y - 10) + dy}px`;
  });

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Don't hijack a tap on the +/- buttons or a navigable part/sense row —
    // capturing the pointer here would retarget their *click* event at the
    // card instead of them, silently swallowing it (the exact bug this had
    // in the extension's popup).
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("[data-popup-nav]")) return;
    const el = popupRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    dragStateRef.current = { startX: e.clientX, startY: e.clientY, baseLeft: r.left, baseTop: r.top };
    el.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const st = dragStateRef.current;
    const el = popupRef.current;
    if (!st || !el) return;
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    if (!draggedRef.current && Math.hypot(dx, dy) > 4) {
      draggedRef.current = true;
      el.style.transform = "none";
    }
    if (draggedRef.current) {
      el.style.left = `${st.baseLeft + dx}px`;
      el.style.top = `${st.baseTop + dy}px`;
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStateRef.current) return;
    dragStateRef.current = null;
    popupRef.current?.releasePointerCapture(e.pointerId);
  }

  return (
    <div
      ref={popupRef}
      onClick={(e) => {
        // A drag ending under the cursor still fires a click — swallow just
        // that one instead of navigating.
        if (draggedRef.current) { e.stopPropagation(); return; }
        onNavigate();
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className="fixed z-[60] px-3 py-2 rounded-xl bg-neutral-900 text-white shadow-xl border border-white/10 max-w-[260px] cursor-grab active:cursor-grabbing select-none touch-none"
      style={{
        left: popup.x,
        top: below ? popup.y + 26 : popup.y - 10,
        transform: below ? "translate(-50%, 0)" : "translate(-50%, -100%)",
      }}
    >
      <div className="text-sm font-medium leading-tight mb-1">{popup.word}</div>

      {popup.parts ? (
        // Not a single headword — same per-part breakdown the extension
        // shows. Each part's text is its own click target (stopPropagation
        // so it doesn't also fire the card's own onNavigate, which points at
        // the whole span); the rest of the card (incl. the hint below) still
        // goes to the full span's page, unchanged.
        <div className="flex flex-col gap-2.5">
          {popup.parts.map((part) => (
            <div key={part.word} className="flex flex-col gap-1.5">
              <div
                data-popup-nav
                className="text-[11px] font-medium text-white/55 hover:text-white/85 hover:underline cursor-pointer -mx-1 px-1 py-0.5 rounded hover:bg-white/[.06]"
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigatePart?.(part.word, part.senses.length === 1 ? part.senses[0].pinyin : undefined);
                }}
              >
                {part.word}
              </div>
              {part.senses.length === 0 ? (
                <div className="text-xs text-white/50 italic">{t.notInVocab}</div>
              ) : (
                part.senses.map((sense, i) => {
                  const saved = part.savedSenseKeys.has(senseKey(sense));
                  return (
                    // The whole row (not just the tight text) is the click
                    // target — a small hit area was the actual bug: most
                    // clicks landed just outside the text and fell through
                    // to the card's own onClick (whole-chunk navigation).
                    <div
                      key={i}
                      data-popup-nav
                      className="flex items-start justify-between gap-2 cursor-pointer -mx-1 px-1 py-0.5 rounded hover:bg-white/[.06]"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigatePart?.(part.word, sense.pinyin);
                      }}
                    >
                      <div className="min-w-0">
                        {sense.pinyin && <div className="text-xs text-violet-300">{sense.pinyin}</div>}
                        <div className="text-xs text-white/90">{sense.meaning}</div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onTogglePartSense?.(part, sense);
                        }}
                        title={saved ? t.removeFromReview : t.queueForReview}
                        // 20px of visible dot sitting inside a ~36px tap target — a
                        // mouse lands on the dot precisely every time, but a finger
                        // routinely misses it by a few px, and a miss here falls
                        // through to this row's own onClick (navigate to the part's
                        // word page) instead of toggling — on mobile that reads as
                        // "+/- does nothing" (you're actually just being navigated
                        // away, so the save never happens and nothing highlights).
                        className="shrink-0 -m-2 p-2 touch-manipulation group"
                      >
                        <span
                          className={`flex w-5 h-5 rounded-full items-center justify-center text-xs font-bold leading-none transition-colors ${
                            saved
                              ? "bg-red-500/90 group-hover:bg-red-500 group-active:bg-red-500"
                              : "bg-violet-500/90 group-hover:bg-violet-500 group-active:bg-violet-500"
                          }`}
                        >
                          {saved ? "–" : "+"}
                        </span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          ))}
          <div className="pt-1.5 mt-0.5 border-t border-white/10 text-[10px] text-white/40">
            {t.openFullWordPage}
          </div>
        </div>
      ) : popup.loading && popup.senses.length === 0 ? (
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
                  // Same hit-slop as the decomposed-part rows below — this row has
                  // no handler of its own, so a near-miss here bubbles all the way
                  // up to the *card's* onClick (navigate to the word page) instead
                  // of toggling. On mobile that's a silent navigation-away instead
                  // of a save, which is why "+/-" felt broken only on touch.
                  className="shrink-0 -m-2 p-2 touch-manipulation group"
                >
                  <span
                    className={`flex w-5 h-5 rounded-full items-center justify-center text-xs font-bold leading-none transition-colors ${
                      saved
                        ? "bg-red-500/90 group-hover:bg-red-500 group-active:bg-red-500"
                        : "bg-violet-500/90 group-hover:bg-violet-500 group-active:bg-violet-500"
                    }`}
                  >
                    {saved ? "–" : "+"}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
