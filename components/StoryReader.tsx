"use client";

import { useRef, useState, useTransition } from "react";
import { logMistake, removeFromReviewQueue } from "@/app/actions/vocabulary";
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

interface WordSense {
  pinyin: string;
  meaning: string;
  hsk_level?: number | null;
}

interface SheetInfo {
  char: string;
  pinyin?: string;
  meaning?: string;
  mastery?: VocabularyMastery;
  queued: boolean;
  source?: string;
  senses?: WordSense[];
  _fetchedDef?: { pinyin: string; meaning: string; hsk_level?: number | null };
}

interface HoverDef {
  pinyin?: string;
  meaning?: string;
  hsk_level?: number | null;
}

interface HoverInfo {
  char: string;
  x: number;
  y: number;
  loading: boolean;
  def?: HoverDef;
}

export function StoryReader({ masteryMap, hskLevel, slangMode }: Props) {
  const { t } = useLanguage();
  const [story, setStory] = useState<Story | null>(null);
  const [topic, setTopic] = useState("");
  const [queuedWords, setQueuedWords] = useState<Set<string>>(new Set());
  const [isGenerating, startGenerate] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetInfo | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const hoverCacheRef = useRef<Map<string, HoverDef>>(new Map());
  const hoverTimerRef = useRef<number | null>(null);

  function clearHoverTimer() {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }

  function hideHoverPopup() {
    clearHoverTimer();
    setHover(null);
  }

  async function resolveHoverDef(char: string) {
    const cached = hoverCacheRef.current.get(char);
    if (cached) {
      setHover((h) => (h && h.char === char ? { ...h, loading: false, def: cached } : h));
      return;
    }
    try {
      const res = await fetch("/api/define-word", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hanzi: char }),
      });
      const def = await res.json();
      if (def.pinyin || def.meaning) {
        hoverCacheRef.current.set(char, def);
        setHover((h) => (h && h.char === char ? { ...h, loading: false, def } : h));
      } else {
        setHover((h) => (h && h.char === char ? { ...h, loading: false } : h));
      }
    } catch {
      setHover((h) => (h && h.char === char ? { ...h, loading: false } : h));
    }
  }

  function handleHoverChar(char: string, rect: DOMRect, mastery: VocabularyMastery | undefined) {
    clearHoverTimer();
    const x = rect.left + rect.width / 2;
    const y = rect.top;
    hoverTimerRef.current = window.setTimeout(() => {
      if (mastery?.meaning) {
        setHover({ char, x, y, loading: false, def: { pinyin: mastery.pinyin, meaning: mastery.meaning, hsk_level: mastery.hsk_level } });
        return;
      }
      setHover({ char, x, y, loading: true });
      resolveHoverDef(char);
    }, 120);
  }

  function generate() {
    setError(null);
    setSheet(null);
    hideHoverPopup();
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
    hideHoverPopup();
    const isQueued = queuedWords.has(char) || !!mastery;

    // Show sheet — let user decide to add/remove
    setSheet({
      char,
      pinyin: mastery?.pinyin,
      meaning: mastery?.meaning,
      mastery,
      queued: isQueued,
    });

    // Fetch definition in background if missing
    if (!mastery?.meaning) {
      try {
        const res = await fetch("/api/define-word", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hanzi: char }),
        });
        const def = await res.json();
        if (def.pinyin || def.meaning) {
          setSheet((s) =>
            s && s.char === char
              ? { ...s, pinyin: s.pinyin || def.pinyin, meaning: s.meaning || def.meaning, source: def.source, queued: s.queued || !!def.already_saved, senses: def.senses, _fetchedDef: def }
              : s
          );
        }
      } catch {
        // silently ignore
      }
    }
  }

  // User picked a specific sense from the sheet's disambiguation list.
  function handlePickSense(sense: WordSense) {
    setSheet((s) =>
      s
        ? {
            ...s,
            pinyin: sense.pinyin,
            meaning: sense.meaning,
            senses: undefined,
            _fetchedDef: s._fetchedDef ? { ...s._fetchedDef, pinyin: sense.pinyin, meaning: sense.meaning, hsk_level: sense.hsk_level } : undefined,
          }
        : s
    );
  }

  async function handleQueue(char: string, mastery: VocabularyMastery | undefined) {
    setQueuedWords((prev) => new Set([...prev, char]));
    setSheet((s) => s ? { ...s, queued: true } : s);
    const sheet_ = sheet;
    await logMistake(mastery?.id ?? char, {
      pinyin: mastery?.pinyin,
      meaning: mastery?.meaning,
      hsk_level: mastery?.hsk_level ?? sheet_?._fetchedDef?.hsk_level ?? undefined,
    }).catch(() => {});
  }

  async function handleUnqueue(char: string, mastery: VocabularyMastery | undefined) {
    setQueuedWords((prev) => { const next = new Set(prev); next.delete(char); return next; });
    setSheet((s) => s ? { ...s, queued: false } : s);
    await removeFromReviewQueue(mastery?.id ?? char).catch(() => {});
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
                onHoverChar={handleHoverChar}
                onHoverLeave={hideHoverPopup}
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

      {/* Hover popup — instant definition on desktop hover, no page nav */}
      {hover && (
        <div
          className="fixed z-[60] pointer-events-none px-3 py-2 rounded-xl bg-neutral-900 text-white shadow-xl border border-white/10 max-w-[220px]"
          style={{
            left: hover.x,
            top: hover.y < 90 ? hover.y + 26 : hover.y - 10,
            transform: hover.y < 90 ? "translate(-50%, 0)" : "translate(-50%, -100%)",
          }}
        >
          <div className="text-sm font-medium leading-tight">{hover.char}</div>
          {hover.loading ? (
            <div className="text-xs text-white/50 mt-0.5">…</div>
          ) : hover.def?.meaning ? (
            <>
              {hover.def.pinyin && (
                <div className="text-xs text-violet-300 mt-0.5">{hover.def.pinyin}</div>
              )}
              <div className="text-xs text-white/90 mt-0.5">{hover.def.meaning}</div>
            </>
          ) : (
            <div className="text-xs text-white/50 italic mt-0.5">{t.notInVocab}</div>
          )}
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

            {/* Multiple senses — no auto-pick, user chooses */}
            {sheet.senses && sheet.senses.length > 1 ? (
              <div className="w-full max-w-xs flex flex-col gap-2">
                <span className="text-xs text-[var(--color-text-muted)] text-center">{t.multipleSenses}</span>
                {sheet.senses.map((sense, i) => (
                  <button
                    key={i}
                    onClick={() => handlePickSense(sense)}
                    className="w-full text-left px-3 py-2 rounded-xl border border-[var(--color-border)] hover:border-violet-400 hover:bg-violet-50 transition-colors"
                  >
                    <div className="text-sm text-[var(--color-text-secondary)]">{sense.pinyin}</div>
                    <div className="text-sm text-[var(--color-text-primary)]">{sense.meaning}</div>
                  </button>
                ))}
              </div>
            ) : (
              <>
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
              </>
            )}

            {sheet.source === "ai" && !sheet.queued && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-center max-w-xs">
                {t.aiDefinitionWarning}
              </p>
            )}
            {sheet.senses && sheet.senses.length > 1 ? null : sheet.queued ? (
              <button
                onClick={() => handleUnqueue(sheet.char, sheet.mastery)}
                className="w-full max-w-xs py-3 rounded-2xl text-sm font-medium transition-all mt-2 bg-red-50 hover:bg-red-100 text-red-500 border border-red-200 cursor-pointer"
              >
                {t.removeFromReview}
              </button>
            ) : (
              <button
                onClick={() => handleQueue(sheet.char, sheet.mastery)}
                className="w-full max-w-xs py-3 rounded-2xl text-sm font-medium transition-all mt-2 bg-violet-50 hover:bg-violet-100 text-violet-600 border border-violet-200 cursor-pointer"
              >
                {t.queueForReview}
              </button>
            )}

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
  onHoverChar,
  onHoverLeave,
}: {
  sentence: StorySentence;
  masteryMap: Record<string, VocabularyMastery>;
  queuedWords: Set<string>;
  onCharTap: (char: string, mastery: VocabularyMastery | undefined) => void;
  onHoverChar: (char: string, rect: DOMRect, mastery: VocabularyMastery | undefined) => void;
  onHoverLeave: () => void;
}) {
  const chars = Array.from(sentence.hanzi);
  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);

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
        const isQueued = queuedWords.has(char) || queuedCoveredIndices.has(i);
        const isPunctuation = /[，。！？、…\s]/.test(char);
        const isInSelection = selLo !== null && selHi !== null && i >= selLo && i <= selHi && !isPunctuation;

        if (isPunctuation) {
          return <span key={i} className="text-[var(--color-text-muted)]">{char}</span>;
        }

        return (
          <span
            key={i}
            onPointerDown={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); handlePointerDown(i); }}
            onPointerEnter={(e) => {
              handlePointerEnter(i);
              if (e.pointerType === "mouse" && !isSelecting) {
                onHoverChar(char, e.currentTarget.getBoundingClientRect(), mastery);
              }
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") onHoverLeave();
            }}
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
