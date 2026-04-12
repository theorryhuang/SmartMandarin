"use client";

import { useState, useTransition } from "react";
import { logMistake } from "@/app/actions/vocabulary";
import type { VocabularyMastery } from "@/lib/types";
import { HIGH_STABILITY_THRESHOLD } from "@/lib/fsrs";

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
  /** All words in vocabulary_mastery for the user — used to detect known/unknown */
  masteryMap: Record<string, VocabularyMastery>;
  hskLevel: number;
  slangMode: boolean;
}

export function StoryReader({ masteryMap, hskLevel, slangMode }: Props) {
  const [story, setStory] = useState<Story | null>(null);
  const [topic, setTopic] = useState("");
  const [showPinyin, setShowPinyin] = useState(false);
  const [showEnglish, setShowEnglish] = useState(false);
  const [queuedWords, setQueuedWords] = useState<Set<string>>(new Set());
  const [isGenerating, startGenerate] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function generate() {
    setError(null);
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

  async function handleWordTap(hanzi: string) {
    setQueuedWords((prev) => new Set([...prev, hanzi]));
    const mastery = masteryMap[hanzi];
    await logMistake(mastery?.id ?? hanzi, {
      pinyin: mastery?.pinyin,
      meaning: mastery?.meaning,
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
          placeholder="Topic (optional) — e.g. 咖啡店, 旅行..."
          className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-sm placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-violet-600"
          onKeyDown={(e) => e.key === "Enter" && generate()}
        />
        <button
          onClick={generate}
          disabled={isGenerating}
          className="px-4 py-2.5 rounded-xl bg-violet-700 hover:bg-violet-600 text-white text-sm font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          {isGenerating ? "Generating…" : "New story"}
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
            {showPinyin && (
              <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                {story.title_pinyin}
              </p>
            )}
            {showEnglish && (
              <p className="text-sm text-[var(--color-text-muted)] mt-0.5 italic">
                {story.title_english}
              </p>
            )}
          </div>

          {/* Display toggles */}
          <div className="flex gap-3">
            {(["pinyin", "english"] as const).map((mode) => {
              const on = mode === "pinyin" ? showPinyin : showEnglish;
              const toggle = mode === "pinyin"
                ? () => setShowPinyin((v) => !v)
                : () => setShowEnglish((v) => !v);
              return (
                <button
                  key={mode}
                  onClick={toggle}
                  className={`px-3 py-1 rounded-full text-xs border transition-all ${
                    on
                      ? "bg-violet-900/40 border-violet-700 text-violet-300"
                      : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                  }`}
                >
                  {mode}
                </button>
              );
            })}
            {queuedWords.size > 0 && (
              <span className="ml-auto text-xs text-[var(--color-text-muted)]">
                {queuedWords.size} word{queuedWords.size !== 1 ? "s" : ""} queued for review
              </span>
            )}
          </div>

          {/* Sentences */}
          <div className="flex flex-col gap-5">
            {story.sentences.map((sentence, i) => (
              <StoryLine
                key={i}
                sentence={sentence}
                masteryMap={masteryMap}
                queuedWords={queuedWords}
                showPinyin={showPinyin}
                showEnglish={showEnglish}
                onWordTap={handleWordTap}
              />
            ))}
          </div>
        </div>
      )}

      {!story && !isGenerating && (
        <div className="flex items-center justify-center h-48 border border-dashed border-[var(--color-border)] rounded-2xl text-sm text-[var(--color-text-muted)]">
          Generate a story to start reading
        </div>
      )}

      {isGenerating && (
        <div className="flex items-center justify-center h-48 text-sm text-[var(--color-text-muted)]">
          <span className="animate-pulse">Generating story…</span>
        </div>
      )}
    </div>
  );
}

function StoryLine({
  sentence,
  masteryMap,
  queuedWords,
  showPinyin,
  showEnglish,
  onWordTap,
}: {
  sentence: StorySentence;
  masteryMap: Record<string, VocabularyMastery>;
  queuedWords: Set<string>;
  showPinyin: boolean;
  showEnglish: boolean;
  onWordTap: (hanzi: string) => void;
}) {
  // Split sentence into individual characters/words for per-word highlighting
  // Simple approach: split on each character since we annotate at char level
  const chars = splitIntoWords(sentence.hanzi);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-x-0.5 gap-y-1 leading-loose">
        {chars.map((char, i) => {
          const mastery = masteryMap[char];
          const isHighStability = mastery && mastery.stability >= HIGH_STABILITY_THRESHOLD;
          const isQueued = queuedWords.has(char);
          const isPunctuation = /[，。！？、…\s]/.test(char);

          if (isPunctuation) {
            return <span key={i} className="text-[var(--color-text-muted)]">{char}</span>;
          }

          return (
            <button
              key={i}
              onClick={() => onWordTap(char)}
              className={`word-token px-0.5 text-lg transition-all ${
                isQueued
                  ? "word-token--mistake"
                  : !isHighStability
                  ? "word-token--unknown"
                  : ""
              }`}
              title={mastery ? `${mastery.pinyin} — ${mastery.meaning}` : "tap to add to review"}
            >
              {char}
            </button>
          );
        })}
      </div>

      {showPinyin && (
        <p className="text-sm text-[var(--color-text-secondary)]">{sentence.pinyin}</p>
      )}
      {showEnglish && (
        <p className="text-sm text-[var(--color-text-muted)] italic">{sentence.english}</p>
      )}
    </div>
  );
}

/**
 * Splits a Chinese sentence into individual characters,
 * preserving punctuation as separate tokens.
 */
function splitIntoWords(text: string): string[] {
  return Array.from(text);
}
