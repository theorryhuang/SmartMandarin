"use client";

import { useState, useTransition } from "react";
import { logMistake } from "@/app/actions/vocabulary";
import type { VocabularyMastery } from "@/lib/types";
import { HIGH_STABILITY_THRESHOLD } from "@/lib/fsrs";
import { useLanguage } from "@/app/_components/LanguageContext";

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

interface SheetInfo {
  char: string;
  pinyin?: string;
  meaning?: string;
  mastery?: VocabularyMastery;
  queued: boolean;
  _fetchedDef?: { pinyin: string; meaning: string };
}

export function StoryReader({ masteryMap, hskLevel, slangMode }: Props) {
  const { t } = useLanguage();
  const [story, setStory] = useState<Story | null>(null);
  const [topic, setTopic] = useState("");
  const [queuedWords, setQueuedWords] = useState<Set<string>>(new Set());
  const [isGenerating, startGenerate] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetInfo | null>(null);

  function generate() {
    setError(null);
    setSheet(null);
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

  async function handleCharTap(char: string, mastery: VocabularyMastery | undefined) {
    // Show sheet immediately with what we have
    setSheet({
      char,
      pinyin: mastery?.pinyin,
      meaning: mastery?.meaning,
      mastery,
      queued: queuedWords.has(char),
    });

    // If word not in vocab, fetch definition in background
    if (!mastery?.meaning) {
      try {
        const res = await fetch("/api/define-word", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hanzi: char, hsk_level: hskLevel }),
        });
        const def = await res.json();
        if (def.pinyin || def.meaning) {
          setSheet((s) =>
            s && s.char === char
              ? { ...s, pinyin: s.pinyin || def.pinyin, meaning: s.meaning || def.meaning, _fetchedDef: def }
              : s
          );
        }
      } catch {
        // silently ignore
      }
    }
  }

  async function handleQueue(char: string, mastery: VocabularyMastery | undefined, fetchedDef?: { pinyin: string; meaning: string }) {
    setQueuedWords((prev) => new Set([...prev, char]));
    setSheet((s) => s ? { ...s, queued: true } : null);
    await logMistake(mastery?.id ?? char, {
      pinyin: mastery?.pinyin || fetchedDef?.pinyin,
      meaning: mastery?.meaning || fetchedDef?.meaning,
      hsk_level: mastery?.hsk_level ?? hskLevel,
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
                onCharTap={handleCharTap}
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

      {/* Bottom sheet */}
      {sheet && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setSheet(null)}
          />
          {/* Sheet */}
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-surface)] border-t border-[var(--color-border)] rounded-t-3xl px-6 py-6 flex flex-col items-center gap-4 shadow-2xl">
            {/* Drag handle */}
            <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />

            {/* Character */}
            <span className="text-6xl font-medium tracking-tight text-[var(--color-text-primary)]">{sheet.char}</span>

            {/* Pinyin */}
            {sheet.pinyin ? (
              <span className="text-lg text-[var(--color-text-secondary)]">{sheet.pinyin}</span>
            ) : (
              <span className="text-sm text-[var(--color-text-muted)] italic">{t.noPinyin}</span>
            )}

            {/* Meaning */}
            {sheet.meaning ? (
              <span className="text-base text-[var(--color-text-primary)] text-center">{sheet.meaning}</span>
            ) : (
              <span className="text-sm text-[var(--color-text-muted)] italic">{t.notInVocab}</span>
            )}

            {/* Queue button */}
            <button
              onClick={() => handleQueue(sheet.char, sheet.mastery, sheet._fetchedDef)}
              disabled={sheet.queued}
              className={`w-full max-w-xs py-3 rounded-2xl text-sm font-medium transition-all mt-2 ${
                sheet.queued
                  ? "bg-red-50 text-red-500 border border-red-200 cursor-default"
                  : "bg-violet-600 hover:bg-violet-700 text-white cursor-pointer"
              }`}
            >
              {sheet.queued ? t.queuedForReview : t.queueForReview}
            </button>

            <button
              onClick={() => setSheet(null)}
              className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors pb-2"
            >
              {t.dismiss}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function StoryLine({
  sentence,
  masteryMap,
  queuedWords,
  onCharTap,
}: {
  sentence: StorySentence;
  masteryMap: Record<string, VocabularyMastery>;
  queuedWords: Set<string>;
  onCharTap: (char: string, mastery: VocabularyMastery | undefined) => void;
}) {
  const chars = Array.from(sentence.hanzi);
  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);

  const selLo = selStart !== null && selEnd !== null ? Math.min(selStart, selEnd) : null;
  const selHi = selStart !== null && selEnd !== null ? Math.max(selStart, selEnd) : null;

  function handlePointerDown(i: number) {
    setSelStart(i);
    setSelEnd(i);
    setIsSelecting(true);
  }

  function handlePointerEnter(i: number) {
    if (isSelecting) setSelEnd(i);
  }

  function handlePointerUp() {
    if (!isSelecting || selStart === null || selEnd === null) return;
    setIsSelecting(false);
    const lo = Math.min(selStart, selEnd);
    const hi = Math.max(selStart, selEnd);
    // skip if selection is entirely punctuation indices
    const selected = chars.slice(lo, hi + 1);
    const word = selected.filter((c) => !/[，。！？、…\s]/.test(c)).join("");
    if (word) {
      onCharTap(word, masteryMap[word]);
    }
    setSelStart(null);
    setSelEnd(null);
  }

  return (
    <div
      className="leading-loose text-lg select-none"
      onPointerUp={handlePointerUp}
      onPointerLeave={() => {
        if (isSelecting) handlePointerUp();
      }}
    >
      {chars.map((char, i) => {
        const mastery = masteryMap[char];
        const isHighStability = mastery && mastery.stability >= HIGH_STABILITY_THRESHOLD;
        const isQueued = queuedWords.has(char);
        const isPunctuation = /[，。！？、…\s]/.test(char);
        const isInSelection = selLo !== null && selHi !== null && i >= selLo && i <= selHi && !isPunctuation;

        if (isPunctuation) {
          return <span key={i} className="text-[var(--color-text-muted)]">{char}</span>;
        }

        return (
          <span
            key={i}
            onPointerDown={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); handlePointerDown(i); }}
            onPointerEnter={() => handlePointerEnter(i)}
            className={`word-token px-0.5 transition-all cursor-pointer touch-none ${
              isInSelection
                ? "bg-violet-600/40 rounded"
                : isQueued
                ? "word-token--mistake"
                : !isHighStability && mastery
                ? "word-token--unknown"
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
