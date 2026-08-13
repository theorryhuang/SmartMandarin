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

  const { popup, popupRef, showHover, hideHover, toggleClick, toggleQueue, navigateToWord, hide } = useWordPopup({
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
}: {
  sentence: StorySentence;
  masteryMap: Record<string, VocabularyMastery>;
  queuedWords: Set<string>;
  onWordClick: (word: string, x: number, y: number, mastery: VocabularyMastery | undefined) => void;
  onWordHover: (word: string, rect: DOMRect, mastery: VocabularyMastery | undefined) => void;
  onHoverLeave: () => void;
}) {
  const chars = Array.from(sentence.hanzi);
  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [hoverSegIdx, setHoverSegIdx] = useState<number | null>(null);

  // Dictionary-based word segmentation — hover/tap targets whole words
  // ("北京" not "北" + "京"), not single characters.
  const wordSegments = useMemo(() => segmentIntoWords(sentence.hanzi), [sentence.hanzi]);
  const segIndexAt = useMemo(() => charSegmentIndex(wordSegments), [wordSegments]);

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

    let word: string;
    if (lo === hi) {
      // Plain tap, no drag — default to the dictionary word under the tap
      // rather than the single character, unless it's punctuation.
      if (/[，。！？、…\s]/.test(chars[lo])) {
        word = "";
      } else {
        const seg = wordSegments[segIndexAt[lo]];
        word = seg && seg.isWordLike ? seg.word : chars[lo];
      }
    } else {
      // User dragged across a range — that's an explicit override, honor it.
      const selected = chars.slice(lo, hi + 1);
      word = selected.filter((c) => !/[，。！？、…\s]/.test(c)).join("");
    }
    if (word) {
      onWordClick(word, e.clientX, e.clientY, masteryMap[word]);
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
        const isInHoverWord = !isPunctuation && hoverSegIdx !== null && segIndexAt[i] === hoverSegIdx;

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
                const word = seg && seg.isWordLike ? seg.word : char;
                setHoverSegIdx(seg ? segIndexAt[i] : null);
                onWordHover(word, e.currentTarget.getBoundingClientRect(), masteryMap[word] ?? mastery);
              }
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") {
                setHoverSegIdx(null);
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
