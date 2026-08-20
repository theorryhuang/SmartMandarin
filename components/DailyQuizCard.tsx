"use client";

import { useState, useTransition, useEffect } from "react";
import { submitDailyQuizAnswer, getWordExamples } from "@/app/actions/dailyLearning";
import type { DailyLearningWord, FSRSRating } from "@/lib/types";
import { useLanguage } from "@/app/_components/LanguageContext";

/**
 * Sentence-building quiz card for the *previous* unresolved day's words —
 * this is what decides pass/fail (Good/Easy = passed, Again/Hard = failed
 * and carried into today's batch). Deliberately not the same component as
 * SentenceCard: that one drives the FSRS review queue directly and offers
 * back/restart/reshuffle; this quiz is a one-way pass over a fixed list
 * reporting a verdict per word, not a browsable review session.
 *
 * Polysemous words (see getWordExamples()'s use-case list) are tested one
 * sense at a time — a simple word with one sense just gets the plain
 * "write a sentence" prompt as before; a word like 尽管 that has a
 * concessive sense and a separate imperative sense gets quizzed on each in
 * turn before a single overall rating is given for the word.
 */

interface GradeResult {
  valid: boolean;
  natural: boolean;
  feedback: string;
  corrected: string | null;
}

interface Props {
  entry: DailyLearningWord;
  currentIndex: number;
  totalCards: number;
  onDone: (passed: boolean) => void;
}

export function DailyQuizCard({ entry, currentIndex, totalCards, onDone }: Props) {
  const { t } = useLanguage();
  const { word } = entry;
  const [useCases, setUseCases] = useState<{ useCase: string; partOfSpeech: string }[] | null>(null);
  const [useCaseIndex, setUseCaseIndex] = useState(0);
  const [useCaseLoadError, setUseCaseLoadError] = useState<string | null>(null);
  const [sentence, setSentence] = useState("");
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    setUseCases(null);
    setUseCaseIndex(0);
    setSentence("");
    setResult(null);
    setGradeError(null);
    setUseCaseLoadError(null);
    setFlipped(false);

    getWordExamples(entry.dailyWordId)
      .then((examples) => {
        const labels = examples
          .filter((ex) => ex.useCase)
          .map((ex) => ({ useCase: ex.useCase, partOfSpeech: ex.partOfSpeech }));
        setUseCases(labels.length > 0 ? labels : [{ useCase: "", partOfSpeech: "" }]);
      })
      // A hiccup generating/fetching use cases (including hitting the
      // use-case generation quota) shouldn't block the quiz — fall back to
      // a single generic attempt, same as before this feature. But unlike
      // before, the reason is now shown rather than swallowed silently, so
      // e.g. a daily-limit message is something you actually see.
      .catch((e) => {
        setUseCaseLoadError(e instanceof Error ? e.message : String(e));
        setUseCases([{ useCase: "", partOfSpeech: "" }]);
      });
  }, [entry.dailyWordId]);

  const isMultiSense = (useCases?.length ?? 0) > 1;
  const currentUseCase = useCases?.[useCaseIndex]?.useCase ?? "";
  const currentPartOfSpeech = useCases?.[useCaseIndex]?.partOfSpeech ?? "";
  const isLastUseCase = useCases !== null && useCaseIndex === useCases.length - 1;

  function checkSentence() {
    if (!sentence.trim() || grading) return;
    setGrading(true);
    setGradeError(null);
    fetch("/api/grade-sentence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hanzi: word.hanzi,
        pinyin: word.pinyin,
        meaning: word.meaning,
        sentence,
        useCase: isMultiSense ? currentUseCase : undefined,
      }),
    })
      .then(async (r) => {
        const data = await r.json();
        if (r.status === 429) {
          setGradeError(
            data.retry_after_seconds
              ? t.sentenceRateLimited(data.retry_after_seconds)
              : t.sentenceCheckFailed
          );
        } else if (data.error) {
          setGradeError(data.error);
        } else {
          setResult(data);
        }
      })
      .catch(() => setGradeError(t.sentenceCheckFailed))
      .finally(() => setGrading(false));
  }

  function nextUseCase() {
    setUseCaseIndex((i) => i + 1);
    setSentence("");
    setResult(null);
    setGradeError(null);
  }

  function rate(rating: FSRSRating) {
    startTransition(async () => {
      const res = await submitDailyQuizAnswer(entry.dailyWordId, word.id, rating);
      onDone(res.passed);
    });
  }

  const RATINGS: { rating: FSRSRating; label: string; color: string }[] = [
    { rating: 1, label: t.again, color: "bg-red-50 hover:bg-red-100 border-red-200 text-red-600" },
    { rating: 2, label: t.hard, color: "bg-orange-50 hover:bg-orange-100 border-orange-200 text-orange-600" },
    { rating: 3, label: t.good, color: "bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-600" },
    { rating: 4, label: t.easy, color: "bg-violet-50 hover:bg-violet-100 border-violet-200 text-violet-600" },
  ];

  const progressPct = ((currentIndex + 1) / totalCards) * 100;

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-md">
      <div className="w-full">
        <div className="flex justify-between mb-1.5 text-xs text-[var(--color-text-muted)]">
          <span>{t.dailyQuizProgress(currentIndex + 1, totalCards)}</span>
          {isMultiSense && (
            <span>{t.dailyQuizUseCaseProgress(useCaseIndex + 1, useCases!.length)}</span>
          )}
        </div>
        <div className="h-1.5 rounded-full bg-[var(--color-border)]">
          <div
            className="h-1.5 rounded-full bg-amber-500 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>
      {useCaseLoadError && (
        <p className="w-full -mt-2 text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
          {useCaseLoadError} — quizzing on the word generally instead.
        </p>
      )}

      <div style={{ perspective: "1000px" }} className="w-full">
        <div
          style={{
            transformStyle: "preserve-3d",
            transition: "transform 0.45s cubic-bezier(0.4,0,0.2,1)",
            transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
            position: "relative",
            height: "160px",
          }}
          className="w-full cursor-pointer"
          onClick={() => !flipped && setFlipped(true)}
        >
          <div
            style={{ backfaceVisibility: "hidden" }}
            className="absolute inset-0 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col items-center justify-center gap-3 select-none"
          >
            <span className="text-5xl font-light tracking-widest">{word.hanzi}</span>
            <span className="text-sm text-[var(--color-text-muted)]">{t.tapToFlip}</span>
          </div>
          <div
            style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
            className="absolute inset-0 rounded-2xl border border-amber-200 bg-[var(--color-surface)] flex flex-col items-center justify-center gap-2 select-none px-6"
          >
            <span className="text-3xl font-light tracking-widest">{word.hanzi}</span>
            <span className="text-base text-[var(--color-text-secondary)]">{word.pinyin}</span>
            {word.meaning && <span className="text-sm text-[var(--color-text-primary)] text-center">{word.meaning}</span>}
          </div>
        </div>
      </div>
      {!flipped && (
        <button
          onClick={() => setFlipped(true)}
          className="-mt-4 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-2.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          {t.showAnswer}
        </button>
      )}

      {useCases === null ? (
        <p className="text-xs text-[var(--color-text-muted)] italic animate-pulse">{t.dailyQuizLoadingUseCases}</p>
      ) : (
        <div className="w-full flex flex-col gap-2">
          {currentPartOfSpeech && (
            <span className="self-start px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 text-[11px] border border-sky-200">
              {currentPartOfSpeech}
            </span>
          )}
          <label className="text-sm text-[var(--color-text-secondary)]">
            {isMultiSense ? t.sentencePromptUseCase(word.hanzi, currentUseCase) : t.sentencePrompt(word.hanzi)}
          </label>
          <textarea
            value={sentence}
            onChange={(e) => {
              setSentence(e.target.value);
              setResult(null);
            }}
            placeholder={t.sentencePlaceholder}
            disabled={grading}
            rows={3}
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-lg resize-none focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
          />
          {!result && (
            <button
              onClick={checkSentence}
              disabled={!sentence.trim() || grading}
              className="w-full rounded-xl bg-amber-600 hover:bg-amber-700 text-white px-4 py-3 text-sm font-medium transition-colors disabled:opacity-40"
            >
              {grading ? t.checkingSentence : t.checkSentence}
            </button>
          )}
          {gradeError && <p className="text-xs text-red-500">{gradeError}</p>}
        </div>
      )}

      {result && (
        <div
          className={`w-full rounded-xl border px-4 py-3 flex flex-col gap-2 text-sm ${
            result.valid && result.natural
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : result.valid
              ? "border-orange-200 bg-orange-50 text-orange-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          <div className="font-medium">
            {result.valid && result.natural ? t.sentenceGreat : result.valid ? t.sentenceOkay : t.sentenceNeedsWork}
          </div>
          <p>{result.feedback}</p>
          {result.corrected && (
            <p className="text-[var(--color-text-secondary)]">
              <span className="font-medium">{t.sentenceSuggested}:</span> {result.corrected}
            </p>
          )}
        </div>
      )}

      {result && !isLastUseCase && (
        <button
          onClick={nextUseCase}
          className="w-full rounded-xl bg-amber-600 hover:bg-amber-700 text-white px-4 py-3 text-sm font-medium transition-colors"
        >
          {t.dailyQuizNextUseCase}
        </button>
      )}

      {result && isLastUseCase ? (
        <div className="w-full grid grid-cols-4 gap-2">
          {RATINGS.map(({ rating, label, color }) => (
            <button
              key={rating}
              onClick={() => rate(rating)}
              disabled={pending}
              className={`rounded-xl border px-3 py-3 text-sm font-medium transition-all disabled:opacity-40 ${color}`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
