"use client";

import { useMemo, useState, useTransition } from "react";
import type { VocabularyMastery } from "@/lib/types";
import { HIGH_STABILITY_THRESHOLD } from "@/lib/fsrs";
import { useLanguage } from "@/app/_components/LanguageContext";
import { segmentIntoWords, charSegmentIndex } from "@/lib/segment";
import { useWordPopup, WordPopupCard } from "@/components/WordPopup";

interface StorySentence {
  hanzi: string;
  pinyin: string;
  english: string;
}

interface Story {
  title: string;
  title_pinyin: string;
  title_english: string;
  sentences: StorySentence[];
}

interface Props {
  masteryMap: Record<string, VocabularyMastery>;
  hskLevel: number;
  slangMode: boolean;
}

export function StoryReader({ masteryMap, hskLevel, slangMode }: Props) {
  const { t } = useLanguage();
  const [story, setStory] = useState<Story | null>(null);
  const [topic, setTopic] = useState("");
  const [queuedWords, setQueuedWords] = useState<Set<string>>(new Set());
  const [isGenerating, startGenerate] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const { popup, popupRef, showHover, hideHover, toggleClick, toggleQueue, navigateToWord, hide, resolveRange } = useWordPopup({
    masteryMap,
    slangMode,
    isQueued: (word) => queuedWords.has(word),
    onQueueChange: (word, queued) => {
      setQueuedWords((prev) => {
        const next = new Set(prev);
        queued ? next.add(word) : next.delete(word);
        return next;
      });
    },
  });

  function generate() {
    setError(null);
    hide();
    startGenerate(async () => {
      const knownWords = Object.values(masteryMap)
        .filter((w) => w.stability >= HIGH_STABILITY_THRESHOLD)
        .map((w) => w.hanzi);

      const res = await fetch("/api/generate-story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hsk_level: hskLevel,
          known_words: knownWords,
          slang_mode: slangMode,
          topic: topic.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      setStory(data);
      setQueuedWords(new Set());
    });
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-2xl mx-auto">
      {/* Controls */}
      <div className="flex gap-2">
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder={t.topicPlaceholder}
          className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-sm placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-violet-600"
          onKeyDown={(e) => e.key === "Enter" && generate()}
        />
        <button
          onClick={generate}
          disabled={isGenerating}
          className="px-4 py-2.5 rounded-xl bg-violet-700 hover:bg-violet-600 text-white text-sm font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          {isGenerating ? t.generating : t.newStory}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      {story && (
        <div className="flex flex-col gap-6">
          {/* Title */}
          <div className="border-b border-[var(--color-border)] pb-4">
            <h2 className="text-2xl font-medium">{story.title}</h2>
          </div>

          {/* Queue count */}
          {queuedWords.size > 0 && (
            <p className="text-xs text-[var(--color-text-muted)]">
              {t.wordsQueued(queuedWords.size)}
            </p>
          )}

          {/* Sentences — hanzi only */}
          <div className="flex flex-col gap-5">
            {story.sentences.map((sentence, i) => (
              <StoryLine
                key={i}
                sentence={sentence}
                masteryMap={masteryMap}
                queuedWords={queuedWords}
                onWordClick={toggleClick}
                onWordHover={showHover}
                onHoverLeave={hideHover}
                resolveRange={resolveRange}
                activeWord={popup?.word ?? null}
              />
            ))}
          </div>
        </div>
      )}

      {!story && !isGenerating && (
        <div className="flex items-center justify-center h-48 border border-dashed border-[var(--color-border)] rounded-2xl text-sm text-[var(--color-text-muted)]">
          {t.generatePrompt}
        </div>
      )}

      {isGenerating && (
        <div className="flex items-center justify-center h-48 text-sm text-[var(--color-text-muted)]">
          <span className="animate-pulse">{t.generatingStory}</span>
        </div>
      )}

      {/* Word definition popup — hover previews, click pins, click again to
          navigate through to the full word page. */}
      {popup && (
        <WordPopupCard
          popup={popup}
          popupRef={popupRef}
          onNavigate={() => navigateToWord(popup)}
          onToggleQueue={() => toggleQueue(popup)}
        />
      )}
    </div>
  );
}

function StoryLine({
  sentence,
  masteryMap,
  queuedWords,
  onWordClick,
  onWordHover,
  onHoverLeave,
  resolveRange,
  activeWord,
}: {
  sentence: StorySentence;
  masteryMap: Record<string, VocabularyMastery>;
  queuedWords: Set<string>;
  // `word` here is the raw Intl.Segmenter span, not necessarily a real
  // dictionary word — the popup hook resolves `offset` against CEDICT
  // itself. `exact: true` bypasses that (an explicit drag-selection).
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
}) {
  const chars = Array.from(sentence.hanzi);
  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [hoverCharIdx, setHoverCharIdx] = useState<number | null>(null);

  // Dictionary-based word segmentation — hover/tap targets whole words
  // ("北京" not "北" + "京"), not single characters.
  const wordSegments = useMemo(() => segmentIntoWords(sentence.hanzi), [sentence.hanzi]);
  const segIndexAt = useMemo(() => charSegmentIndex(wordSegments), [wordSegments]);

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

  const selLo = selStart !== null && selEnd !== null ? Math.min(selStart, selEnd) : null;
  const selHi = selStart !== null && selEnd !== null ? Math.max(selStart, selEnd) : null;

  // Precompute which char indices are covered by a queued multi-char compound
  // at that exact position in the sentence (so individual chars remain selectable).
  const sentenceStr = chars.join("");
  const queuedCoveredIndices = new Set<number>();
  for (const word of queuedWords) {
    if (word.length <= 1) continue;
    let pos = 0;
    while ((pos = sentenceStr.indexOf(word, pos)) !== -1) {
      for (let j = pos; j < pos + word.length; j++) {
        queuedCoveredIndices.add(j);
      }
      pos++;
    }
  }

  function handlePointerDown(i: number) {
    setSelStart(i);
    setSelEnd(i);
    setIsSelecting(true);
  }

  function handlePointerEnter(i: number) {
    if (isSelecting) setSelEnd(i);
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (!isSelecting || selStart === null || selEnd === null) return;
    setIsSelecting(false);
    const lo = Math.min(selStart, selEnd);
    const hi = Math.max(selStart, selEnd);

    if (lo === hi) {
      // Plain tap, no drag — hand off the Intl.Segmenter span + offset;
      // the popup hook resolves it against CEDICT itself.
      if (!/[，。！？、…\s]/.test(chars[lo])) {
        const seg = wordSegments[segIndexAt[lo]];
        const segWord = seg && seg.isWordLike ? seg.word : chars[lo];
        const offset = seg && seg.isWordLike ? lo - seg.start : 0;
        onWordClick(segWord, offset, e.clientX, e.clientY);
      }
    } else {
      // User dragged across a range — that's an explicit override, honor it exactly.
      const selected = chars.slice(lo, hi + 1);
      const word = selected.filter((c) => !/[，。！？、…\s]/.test(c)).join("");
      if (word) onWordClick(word, 0, e.clientX, e.clientY, true);
    }
    setSelStart(null);
    setSelEnd(null);
  }

  return (
    <div
      className="leading-loose text-lg select-none"
      onPointerUp={handlePointerUp}
      onPointerLeave={(e) => {
        if (isSelecting) handlePointerUp(e);
      }}
    >
      {chars.map((char, i) => {
        const mastery = masteryMap[char];
        const isHighStability = mastery && mastery.stability >= HIGH_STABILITY_THRESHOLD;
        const isQueued = queuedWords.has(char) || queuedCoveredIndices.has(i);
        const isPunctuation = /[，。！？、…\s]/.test(char);
        const isInSelection = selLo !== null && selHi !== null && i >= selLo && i <= selHi && !isPunctuation;
        const isInHoverWord = !isPunctuation && hoverRange !== null && i >= hoverRange.start && i < hoverRange.end;

        if (isPunctuation) {
          return <span key={i} className="text-[var(--color-text-muted)]">{char}</span>;
        }

        return (
          <span
            key={i}
            data-word-token
            onPointerDown={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); handlePointerDown(i); }}
            onPointerEnter={(e) => {
              handlePointerEnter(i);
              if (e.pointerType === "mouse" && !isSelecting) {
                const seg = wordSegments[segIndexAt[i]];
                const segWord = seg && seg.isWordLike ? seg.word : char;
                const offset = seg && seg.isWordLike ? i - seg.start : 0;
                setHoverCharIdx(i);
                onWordHover(segWord, offset, e.currentTarget.getBoundingClientRect());
              }
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") {
                setHoverCharIdx(null);
                onHoverLeave();
              }
            }}
            className={`word-token px-0.5 transition-all cursor-pointer touch-none ${
              isInSelection
                ? "bg-violet-600/40 rounded"
                : isQueued
                ? "word-token--mistake"
                : !isHighStability && mastery
                ? "word-token--unknown"
                : isInHoverWord
                ? "bg-violet-500/15 rounded"
                : ""
            }`}
          >
            {char}
          </span>
        );
      })}
    </div>
  );
}
