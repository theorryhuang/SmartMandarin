"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { Sparkles, BookOpenText, Plus, Brain } from "lucide-react";
import { getDailyState, startDailyBatch, addToDailyBatch, getWordExamples } from "@/app/actions/dailyLearning";
import type { DailyState, DailyLearningWord, VocabularyMastery, WordExample } from "@/lib/types";
import { DailyQuizCard } from "@/components/DailyQuizCard";
import { ReviewSession } from "@/app/review/ReviewSession";
import { useLanguage } from "@/app/_components/LanguageContext";

function WordTile({ entry }: { entry: DailyLearningWord }) {
  const { t } = useLanguage();
  const { word, carriedOver, dailyWordId } = entry;
  const [flipped, setFlipped] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [examples, setExamples] = useState<WordExample[] | null>(null);
  const [examplesError, setExamplesError] = useState<string | null>(null);
  const [loadingExamples, startLoadingExamples] = useTransition();
  const [meaningExpanded, setMeaningExpanded] = useState(false);
  const [meaningOverflows, setMeaningOverflows] = useState(false);
  const meaningRef = useRef<HTMLDivElement>(null);

  // Only offer the expand toggle when the single-line truncation is
  // actually clipping something — measured while still collapsed, so
  // `.truncate`'s overflow:hidden is in effect and scrollWidth reflects the
  // full untruncated text.
  useEffect(() => {
    if (!flipped || meaningExpanded) return;
    const el = meaningRef.current;
    if (el) setMeaningOverflows(el.scrollWidth > el.clientWidth);
  }, [flipped, meaningExpanded, word.meaning]);

  function toggleExamples() {
    const next = !examplesOpen;
    setExamplesOpen(next);
    if (next && examples === null && !loadingExamples) {
      setExamplesError(null);
      startLoadingExamples(async () => {
        try {
          const ex = await getWordExamples(dailyWordId);
          setExamples(ex);
        } catch (e) {
          setExamplesError(e instanceof Error ? e.message : String(e));
        }
      });
    }
  }

  return (
    <div className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setFlipped((f) => !f)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setFlipped((f) => !f);
        }}
        className="px-4 py-3.5 flex items-center justify-between text-left cursor-pointer select-none"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-2xl font-light tracking-wide flex-shrink-0">{word.hanzi}</span>
          {flipped ? (
            <div className="min-w-0">
              <div className="text-sm text-[var(--color-text-secondary)]">{word.pinyin}</div>
              <div
                ref={meaningRef}
                className={`text-xs text-[var(--color-text-muted)] ${meaningExpanded ? "" : "truncate"}`}
              >
                {word.meaning}
              </div>
              {meaningOverflows && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMeaningExpanded((v) => !v);
                  }}
                  className="text-[10px] text-amber-700 hover:underline mt-0.5"
                >
                  {meaningExpanded ? t.dailyShowLess : t.dailyShowMore}
                </button>
              )}
            </div>
          ) : (
            <span className="text-xs text-[var(--color-text-muted)]">{t.tapToFlip}</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {carriedOver && (
            <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-600 text-[10px] border border-orange-200">
              {t.dailyCarriedOver}
            </span>
          )}
          {word.hsk_level != null && (
            <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] border border-amber-200">
              HSK {Math.floor(word.hsk_level)}
            </span>
          )}
        </div>
      </div>

      <button
        onClick={toggleExamples}
        className="w-full px-4 py-2 flex items-center gap-1.5 text-xs text-amber-700 border-t border-[var(--color-border)] hover:bg-amber-50 transition-colors"
      >
        <BookOpenText size={13} />
        {examplesOpen ? t.dailyHideExamples : t.dailyShowExamples}
      </button>

      {examplesOpen && (
        <div className="px-4 pb-3 pt-1 flex flex-col gap-2.5 border-t border-[var(--color-border)] bg-[var(--color-background)]">
          {loadingExamples && (
            <p className="text-xs text-[var(--color-text-muted)] italic animate-pulse py-1">{t.dailyExamplesLoading}</p>
          )}
          {examplesError && <p className="text-xs text-red-500 py-1">{examplesError}</p>}
          {examples?.map((ex, i) => (
            <div key={i} className="text-sm pt-1.5 first:pt-2">
              {/* Only worth labeling when there's more than one sense to
                  tell apart — a single-sense word's one example doesn't
                  need a "which use case is this" caption. */}
              {examples.length > 1 && ex.useCase && (
                <div className="text-[10px] font-medium text-amber-700 uppercase tracking-wide mb-0.5">{ex.useCase}</div>
              )}
              <div className="text-[var(--color-text-primary)]">{ex.sentence}</div>
              <div className="text-xs text-[var(--color-text-muted)] mt-0.5">{ex.pinyin}</div>
              <div className="text-xs text-[var(--color-text-secondary)]">{ex.translation}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddMoreControl({ onAdd, loading }: { onAdd: (n: number) => void; loading: boolean }) {
  const { t } = useLanguage();
  const [count, setCount] = useState("5");
  return (
    <div className="w-full flex items-center gap-2">
      <input
        type="number"
        min={1}
        value={count}
        onChange={(e) => setCount(e.target.value)}
        className="w-16 text-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
      />
      <button
        onClick={() => {
          const n = parseInt(count, 10);
          if (Number.isFinite(n) && n >= 1) onAdd(n);
        }}
        disabled={loading}
        className="flex-1 flex items-center justify-center gap-1 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700 px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50"
      >
        <Plus size={14} />
        {loading ? t.dailyBuilding : t.dailyAddMore}
      </button>
    </div>
  );
}

/**
 * The day boundary this whole feature hangs off of, taken from the browser
 * so it lines up with the user's actual calendar day instead of a server
 * clock resetting everyone at the same UTC instant — see todayStr() in
 * app/actions/dailyLearning.ts. "en-CA" is just a locale that happens to
 * format as YYYY-MM-DD; it has nothing to do with the user's real locale.
 */
function localToday(): string {
  return new Date().toLocaleDateString("en-CA");
}

export function DailyClient() {
  const { t } = useLanguage();
  const [state, setState] = useState<DailyState | null>(null);
  const [quizIndex, setQuizIndex] = useState(0);
  const [count, setCount] = useState("10");
  const [loading, startLoading] = useTransition();
  const [addingMore, startAddingMore] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [reviewingToday, setReviewingToday] = useState(false);

  function refresh() {
    startLoading(async () => {
      const s = await getDailyState(localToday());
      setState(s);
      setQuizIndex(0);
    });
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleBuild() {
    const n = parseInt(count, 10);
    if (!Number.isFinite(n) || n < 1) return;
    setError(null);
    startLoading(async () => {
      try {
        const batch = await startDailyBatch(n, localToday());
        if (batch === null) {
          setError("NO_WORDS");
        } else {
          setState((s) => (s ? { ...s, todayBatch: batch } : s));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function handleAddMore(n: number) {
    setAddError(null);
    const before = state?.todayBatch?.words.length ?? 0;
    startAddingMore(async () => {
      try {
        const batch = await addToDailyBatch(n, localToday());
        if (batch.words.length === before) {
          setAddError("NO_WORDS");
        } else {
          setState((s) => (s ? { ...s, todayBatch: batch } : s));
        }
      } catch (e) {
        setAddError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  if (state === null) {
    return (
      <div className="flex flex-col min-h-screen">
        <div className="flex-1 flex items-center justify-center text-sm text-[var(--color-text-muted)]">{t.loading}</div>
      </div>
    );
  }

  // ── Reviewing today's words on demand — reuses the same flashcard/sentence
  //    ReviewSession as /review, scoped to just today's batch. This is
  //    separate from tomorrow's pass/fail quiz (DailyQuizCard): rating a
  //    card here updates its FSRS schedule like any other review, but
  //    doesn't mark it passed/failed for the daily program — only the quiz
  //    does that. ──
  if (reviewingToday && state.todayBatch) {
    const todayWords: VocabularyMastery[] = state.todayBatch.words.map((w) => w.word);
    return (
      <ReviewSession
        initialCards={todayWords}
        sessionKey={`sm_daily_review_${state.todayBatch.batchDate}`}
        getAllWordsFn={async () => todayWords}
        onExit={() => setReviewingToday(false)}
      />
    );
  }

  // ── Phase 1: quiz the previous unresolved day's words ──────────────────────
  const quizWords = state.quizBatch?.words ?? [];
  if (quizWords.length > 0 && quizIndex < quizWords.length) {
    return (
      <div className="flex flex-col min-h-screen">
        <div className="flex-1 flex flex-col items-center justify-center px-6 pb-6">
          <div className="w-full max-w-md mb-4 text-center">
            <h2 className="text-lg font-medium">{t.dailyQuizTitle}</h2>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">{t.dailyQuizDesc(quizWords.length)}</p>
          </div>
          <DailyQuizCard
            key={quizWords[quizIndex].dailyWordId}
            entry={quizWords[quizIndex]}
            currentIndex={quizIndex}
            totalCards={quizWords.length}
            onDone={() => {
              const next = quizIndex + 1;
              if (next >= quizWords.length) {
                refresh(); // re-fetch: quiz resolved, move to today's batch step
              } else {
                setQuizIndex(next);
              }
            }}
          />
        </div>
      </div>
    );
  }

  // ── Phase 2: today's batch already built — show it, allow adding more ──────
  if (state.todayBatch) {
    const { words, targetCount } = state.todayBatch;
    return (
      <div className="flex flex-col min-h-screen">
        <div className="flex-1 flex flex-col items-center px-6 pb-6 gap-4 max-w-md mx-auto w-full">
          <div className="text-center mt-2">
            <div className="mx-auto mb-2 w-11 h-11 rounded-xl bg-amber-100 flex items-center justify-center">
              <Sparkles size={22} className="text-amber-600" />
            </div>
            <h2 className="text-lg font-medium">{t.dailyTodayTitle}</h2>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">{t.dailyTodaySubtitle(words.length, targetCount)}</p>
          </div>
          <div className="w-full flex flex-col gap-2">
            {words.map((w) => (
              <WordTile key={w.dailyWordId} entry={w} />
            ))}
          </div>
          <button
            onClick={() => setReviewingToday(true)}
            className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white px-4 py-3 text-sm font-medium transition-colors"
          >
            <Brain size={16} />
            {t.dailyReviewToday}
          </button>
          <AddMoreControl onAdd={handleAddMore} loading={addingMore} />
          {addError === "NO_WORDS" ? (
            <p className="text-xs text-emerald-600 text-center">{t.dailyNoWordsLeft}</p>
          ) : addError ? (
            <p className="text-xs text-red-500 text-center">{addError}</p>
          ) : null}
          <p className="text-xs text-[var(--color-text-muted)] text-center mt-2">{t.dailyComeBackTomorrow}</p>
        </div>
      </div>
    );
  }

  // ── Phase 3: no batch for today yet — ask how many words ───────────────────
  return (
    <div className="flex flex-col min-h-screen">
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-6 gap-5 max-w-sm mx-auto w-full text-center">
        <div className="w-11 h-11 rounded-xl bg-amber-100 flex items-center justify-center">
          <Sparkles size={22} className="text-amber-600" />
        </div>
        <h2 className="text-xl font-medium">{t.dailyHowMany}</h2>
        <p className="text-sm text-[var(--color-text-muted)]">{t.dailyHowManyDesc}</p>
        <input
          type="number"
          min={1}
          value={count}
          onChange={(e) => setCount(e.target.value)}
          className="w-24 text-center text-2xl rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <button
          onClick={handleBuild}
          disabled={loading}
          className="w-full rounded-xl bg-amber-600 hover:bg-amber-700 text-white px-5 py-3 font-medium transition-colors disabled:opacity-50"
        >
          {loading ? t.dailyBuilding : t.dailyStart}
        </button>
        {error === "QUIZ_PENDING" ? (
          <p className="text-xs text-red-500">{t.dailyQuizPendingError}</p>
        ) : error === "NO_WORDS" ? (
          <p className="text-xs text-emerald-600">{t.dailyNoWordsLeft}</p>
        ) : error ? (
          <p className="text-xs text-red-500">{error}</p>
        ) : null}
      </div>
    </div>
  );
}
