"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MasteryMap } from "@/lib/types";
import { HIGH_STABILITY_THRESHOLD } from "@/lib/fsrs";
import { segmentIntoWords, charSegmentIndex } from "@/lib/segment";
import { useIsDesktopPointer } from "@/lib/useIsDesktopPointer";
import { useHasExtension } from "@/lib/useHasExtension";

// Renders Mandarin text with drag-to-select multi-character words plus
// per-word hover/click wired into useWordPopup — the same word-lookup
// popup (and browser-extension deferral) everywhere this is used: the
// chatbot's AI replies, and speaking practice's transcript (both sides).
// No extra spacing between characters — uses natural inline text flow.
//
// Extracted out of ConversationClient.tsx (where it started as a private
// `TappableMessage`) so speaking practice could reuse the exact same
// implementation instead of a separate, thinner hand-rolled version.

export function TappableText({
  text,
  masteryMap,
  savedWords,
  onWordClick,
  onWordHover,
  onHoverLeave,
  resolveRange,
  activeWord,
  variant = "light",
}: {
  text: string;
  masteryMap: MasteryMap;
  savedWords: Set<string>;
  // `word` here is the raw Intl.Segmenter span, not necessarily a real
  // dictionary word — the popup hook resolves `offset` against CEDICT
  // itself. `exact: true` bypasses that (an explicit text selection).
  onWordClick: (word: string, offset: number, x: number, y: number, exact?: boolean) => void;
  onWordHover: (word: string, offset: number, rect: DOMRect) => void;
  onHoverLeave: () => void;
  // Sync lookup of which char range (within a segment) is the actual
  // resolved CEDICT headword — so the highlight can track e.g. just "步步"
  // inside "一步步" instead of lighting up the whole segmenter span.
  resolveRange: (segWord: string, offset: number) => { start: number; end: number };
  // Only used to force a recompute of the highlight once async resolution
  // lands (resolveRange itself reads a ref, so it won't trigger renders).
  activeWord: string | null;
  /** "dark" = white-on-violet bubble (e.g. speaking practice's own-turn
   *  bubble) — the default `.word-token` highlight colors assume a light
   *  background and read as muddy on a solid violet fill. */
  variant?: "light" | "dark";
}) {
  type Seg = { type: "hanzi" | "punct" | "other"; content: string; idx: number };
  const segments: Seg[] = [];
  let hanziIdx = 0;

  const cleaned = text.replace(/\s*\([^)]{1,30}\)/g, "");

  for (const char of cleaned) {
    if (/[一-鿿㐀-䶿]/.test(char)) {
      segments.push({ type: "hanzi", content: char, idx: hanziIdx++ });
    } else if (/[，。！？、…]/.test(char)) {
      segments.push({ type: "punct", content: char, idx: -1 });
    } else {
      segments.push({ type: "other", content: char, idx: -1 });
    }
  }

  // Dictionary-based word segmentation over the same char sequence — hover
  // and click both target the whole word ("北京", not "北" + "京").
  const wordSegments = useMemo(() => segmentIntoWords(cleaned), [cleaned]);
  const segIndexAt = useMemo(() => charSegmentIndex(wordSegments), [wordSegments]);
  const [hoverCharIdx, setHoverCharIdx] = useState<number | null>(null);

  // The actual highlighted range — the resolved CEDICT headword's char span
  // within its segment, not the whole (possibly wider) segmenter span.
  const hoverRange = useMemo(() => {
    if (hoverCharIdx === null) return null;
    const seg = wordSegments[segIndexAt[hoverCharIdx]];
    if (!seg || !seg.isWordLike) return { start: hoverCharIdx, end: hoverCharIdx + 1 };
    const offset = hoverCharIdx - seg.start;
    const range = resolveRange(seg.word, offset);
    return { start: seg.start + range.start, end: seg.start + range.end };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverCharIdx, wordSegments, segIndexAt, resolveRange, activeWord]);

  // Desktop (real mouse) defers entirely to the browser extension, which
  // needs a genuine native selection to detect — and would otherwise pop up
  // side-by-side with this component's own card for the same selection.
  // Touch devices (no extension, worse UX for drag-to-select CJK text) keep
  // the in-app popup exactly as before. Only actually defer when the
  // extension is confirmed present on this page (see useHasExtension) —
  // otherwise a desktop browser/profile/window without it installed would
  // get no popup at all, not even this app's own.
  const isDesktop = useIsDesktopPointer();
  const hasExtension = useHasExtension();
  const deferToExtension = isDesktop && hasExtension;
  const containerRef = useRef<HTMLDivElement>(null);
  const onWordClickRef = useRef(onWordClick);
  useEffect(() => { onWordClickRef.current = onWordClick; }, [onWordClick]);
  const hanziSegs = segments.filter((s) => s.type === "hanzi");
  const hanziStr = hanziSegs.map((s) => s.content).join("");
  const savedCoveredIndices = new Set<number>();
  for (const word of savedWords) {
    if (word.length <= 1) continue;
    let pos = 0;
    while ((pos = hanziStr.indexOf(word, pos)) !== -1) {
      for (let j = pos; j < pos + word.length; j++) {
        savedCoveredIndices.add(hanziSegs[j].idx);
      }
      pos++;
    }
  }

  useEffect(() => {
    if (deferToExtension) return; // leave native selection alone for the extension
    const el = containerRef.current;
    if (!el) return;
    const onEnd = () => {
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) return;
        const selected = sel.toString().replace(/[^一-鿿㐀-䶿]/g, "");
        // A single-character "selection" here is almost never a deliberate
        // drag — it's the mobile browser's own native long-press/double-tap
        // word-select, an artifact of the tap gesture itself (a desktop
        // mouse click never produces this; there's no equivalent accidental
        // native-select on mouseup). Left alone, that phantom selection did
        // two things wrong: it hijacked this ordinary tap into `exact` mode
        // with whatever single char the OS's own word-boundary guess landed
        // on — not necessarily the same span the per-token click handler
        // would've resolved via CEDICT — and since it was never cleared,
        // it also made the *next* tap's `sel.isCollapsed` check in that
        // handler misfire and no-op. Only a genuine multi-char drag counts
        // as an explicit override; anything shorter just gets cleared so
        // the deliberate, correctly-segmented per-token click handles it.
        if (selected.length < 2) {
          sel.removeAllRanges();
          return;
        }
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        // Explicit text selection — a literal override, skip CEDICT resolution.
        onWordClickRef.current(selected, 0, rect.left + rect.width / 2, rect.top, true);
        setTimeout(() => sel.removeAllRanges(), 150);
      }, 50);
    };
    el.addEventListener("mouseup", onEnd);
    el.addEventListener("touchend", onEnd);
    return () => {
      el.removeEventListener("mouseup", onEnd);
      el.removeEventListener("touchend", onEnd);
    };
  }, [deferToExtension]);

  return (
    <div
      ref={containerRef}
      className="leading-loose text-[15px]"
    >
      {segments.map((seg, i) => {
        if (seg.type === "punct") {
          return (
            <span key={i} className={variant === "dark" ? "text-violet-200" : "text-[var(--color-text-muted)]"}>
              {seg.content}
            </span>
          );
        }
        if (seg.type === "other") {
          return <span key={i}>{seg.content}</span>;
        }

        const isSaved = savedWords.has(seg.content) || savedCoveredIndices.has(seg.idx);
        // Aggregate across every saved sense of this hanzi — the highlight
        // is per-character, not per-sense (the popup handles per-sense detail).
        const isLearning = (masteryMap[seg.content] ?? []).some((s) => s.stability < HIGH_STABILITY_THRESHOLD);
        const wordSeg = wordSegments[segIndexAt[i]];
        const dictWord = wordSeg && wordSeg.isWordLike ? wordSeg.word : seg.content;
        const offset = wordSeg && wordSeg.isWordLike ? i - wordSeg.start : 0;
        const isInHoverWord = hoverRange !== null && i >= hoverRange.start && i < hoverRange.end;

        // Plain tap-to-open on everything except an actual desktop+extension
        // page (there the extension owns clicks/selection, and would pop up
        // side-by-side with this on the same tap). Dropping this in favor of
        // a drag-select-only model (to mirror the extension everywhere) made
        // mobile — which never has the extension — feel broken: a bare tap,
        // the only gesture most phone users try, did nothing.
        return (
          <span
            key={i}
            data-word-token
            onClick={(e) => {
              if (deferToExtension) return; // extension owns clicks/selection here
              const sel = window.getSelection();
              // Only bail for a genuine multi-char selection (a real drag —
              // onEnd above already handled it). A 1-char "selection" is the
              // mobile browser's own native word-select reflex firing off
              // this exact tap, not a real drag; onEnd clears it shortly
              // after, but this click can land first, so it needs the same
              // >= 2 threshold or a bare tap silently does nothing on touch.
              if (sel && !sel.isCollapsed && sel.toString().replace(/[^一-鿿㐀-䶿]/g, "").length >= 2) return;
              const rect = e.currentTarget.getBoundingClientRect();
              onWordClickRef.current(dictWord, offset, rect.left + rect.width / 2, rect.top);
            }}
            onPointerEnter={(e) => {
              if (!deferToExtension && e.pointerType === "mouse") {
                setHoverCharIdx(i);
                onWordHover(dictWord, offset, e.currentTarget.getBoundingClientRect());
              }
            }}
            onPointerLeave={(e) => {
              if (!deferToExtension && e.pointerType === "mouse") {
                setHoverCharIdx(null);
                onHoverLeave();
              }
            }}
            className={`${deferToExtension ? "cursor-text" : "cursor-pointer"} rounded-sm transition-colors ${
              variant === "dark"
                ? isSaved
                  ? "bg-white/25 text-white line-through decoration-white/60 opacity-90"
                  : isLearning
                  ? "bg-white/20 text-white"
                  : isInHoverWord
                  ? "bg-white/25 text-white"
                  : "hover:bg-white/15"
                : isSaved
                ? "word-token word-token--mistake"
                : isLearning
                ? "word-token word-token--unknown"
                : isInHoverWord
                ? "bg-violet-500/15"
                : "hover:bg-slate-100"
            }`}
          >
            {seg.content}
          </span>
        );
      })}
    </div>
  );
}
