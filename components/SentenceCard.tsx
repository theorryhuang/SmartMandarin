"use client";

import { useState, useTransition, useEffect } from "react";
import { submitReview } from "@/app/actions/vocabulary";
import type { VocabularyMastery, FSRSRating } from "@/lib/types";
import { useLanguage } from "@/app/_components/LanguageContext";

interface GradeResult {
  valid: boolean;
  natural: boolean;
  feedback: string;
  corrected: string | null;
}

interface Props {
  card: VocabularyMastery;
  onNext: (result: { stability: number; difficulty: number; next_review: string }) => void;
  onBack: () => void;
  canGoBack: boolean;
  onRestart: () => void;
  onReshuffle: () => void;
  currentIndex: number;
  totalCards: number;
}

export function SentenceCard({ card, onNext, onBack, canGoBack, onRestart, onReshuffle, currentIndex, totalCards }: Props) {
  const { t } = useLanguage();
  const [sentence, setSentence] = useState("");
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [fetchedPinyin, setFetchedPinyin] = useState<string | null>(null);
  const [fetchedMeaning, setFetchedMeaning] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    setSentence("");
    setResult(null);
    setGradeError(null);
    setFetchedPinyin(null);
    setFetchedMeaning(null);
    setFlipped(false);
    if (!card.meaning || !card.pinyin) {
      fetch("/api/define-word", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hanzi: card.hanzi }),
      })
        .then((r) => r.json())
        .then((def) => {
          if (def.pinyin) setFetchedPinyin(def.pinyin);
          if (def.meaning) setFetchedMeaning(def.meaning);
        })
        .catch(() => {});
    }
  }, [card.id]);

  const pinyin = card.pinyin || fetchedPinyin;
  const meaning = card.meaning || fetchedMeaning;

  const RATINGS: { rating: FSRSRating; label: string; color: string }[] = [
    { rating: 1, label: t.again, color: "bg-red-50 hover:bg-red-100 border-red-200 text-red-600" },
    { rating: 2, label: t.hard,  color: "bg-orange-50 hover:bg-orange-100 border-orange-200 text-orange-600" },
    { rating: 3, label: t.good,  color: "bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-600" },
    { rating: 4, label: t.easy,  color: "bg-violet-50 hover:bg-violet-100 border-violet-200 text-violet-600" },
  ];

  function checkSentence() {
    if (!sentence.trim() || grading) return;
    setGrading(true);
    setGradeError(null);
    fetch("/api/grade-sentence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hanzi: card.hanzi, pinyin, meaning, sentence }),
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

  function rate(rating: FSRSRating) {
    startTransition(async () => {
      try {
        const res = await submitReview(card.id, rating, "review_session");
        onNext({ stability: res.stability, difficulty: res.difficulty, next_review: res.next_review });
      } catch (err) {
        if (err instanceof Error && err.message === "WORD_DELETED") {
          onNext({ stability: card.stability, difficulty: card.difficulty, next_review: new Date().toISOString() });
        } else {
          throw err;
        }
      }
    });
  }

  const progressPct = ((currentIndex + 1) / totalCards) * 100;

  // Suggest a rating based on Gemini's verdict, but let the user override.
  const suggestedRating: FSRSRating | null = !result
    ? null
    : !result.valid
    ? 1
    : !result.natural
    ? 2
    : 3;

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-md">
      {/* Session progress */}
      <div className="w-full">
        <div className="flex justify-between mb-1.5 text-xs text-[var(--color-text-muted)]">
          <span>{t.cardProgress(currentIndex + 1, totalCards)}</span>
          <div className="flex items-center gap-3">
            {canGoBack && (
              <button
                onClick={onBack}
                disabled={pending}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors disabled:opacity-40"
              >
                ← {t.prevCard}
              </button>
            )}
            <button
              onClick={onRestart}
              disabled={pending}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors disabled:opacity-40"
            >
              ↩ {t.restartSession}
            </button>
            <button
              onClick={onReshuffle}
              disabled={pending}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors disabled:opacity-40"
            >
              ⇄ {t.reshuffleSession}
            </button>
          </div>
        </div>
        <div className="h-1.5 rounded-full bg-[var(--color-border)]">
          <div
            className="h-1.5 rounded-full bg-violet-500 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Word prompt — flip card so the definition is optional */}
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
          {/* ── Front: hanzi only ── */}
          <div
            style={{ backfaceVisibility: "hidden" }}
            className="absolute inset-0 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col items-center justify-center gap-3 select-none"
          >
            <span className="text-5xl font-light tracking-widest">{card.hanzi}</span>
            <span className="text-sm text-[var(--color-text-muted)]">{t.tapToFlip}</span>
          </div>

          {/* ── Back: pinyin + meaning ── */}
          <div
            style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
            className="absolute inset-0 rounded-2xl border border-violet-200 bg-[var(--color-surface)] flex flex-col items-center justify-center gap-2 select-none px-6"
          >
            <span className="text-3xl font-light tracking-widest">{card.hanzi}</span>
            {pinyin ? (
              <span className="text-base text-[var(--color-text-secondary)]">{pinyin}</span>
            ) : (
              <span className="text-sm text-[var(--color-text-muted)] italic animate-pulse">{t.loading}</span>
            )}
            {meaning && <span className="text-sm text-[var(--color-text-primary)] text-center">{meaning}</span>}
            {/* Slang badge disabled for now — parked for a later version.
            {card.is_slang && (
              <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-600 text-xs border border-violet-200">
                {t.slangBadge}
              </span>
            )}
            */}
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

      {/* Sentence input */}
      <div className="w-full flex flex-col gap-2">
        <label className="text-sm text-[var(--color-text-secondary)]">
          {t.sentencePrompt(card.hanzi)}
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
          className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-lg resize-none focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:opacity-60"
        />
        {!result && (
          <button
            onClick={checkSentence}
            disabled={!sentence.trim() || grading}
            className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 text-white px-4 py-3 text-sm font-medium transition-colors disabled:opacity-40"
          >
            {grading ? t.checkingSentence : t.checkSentence}
          </button>
        )}
        {gradeError && (
          <p className="text-xs text-red-500">{gradeError}</p>
        )}
      </div>

      {/* Gemini feedback */}
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
            {result.valid && result.natural
              ? t.sentenceGreat
              : result.valid
              ? t.sentenceOkay
              : t.sentenceNeedsWork}
          </div>
          <p>{result.feedback}</p>
          {result.corrected && (
            <p className="text-[var(--color-text-secondary)]">
              <span className="font-medium">{t.sentenceSuggested}:</span> {result.corrected}
            </p>
          )}
        </div>
      )}

      {/* Rating buttons — only after grading */}
      {result ? (
        <div className="w-full grid grid-cols-4 gap-2">
          {RATINGS.map(({ rating, label, color }) => (
            <button
              key={rating}
              onClick={() => rate(rating)}
              disabled={pending}
              className={`rounded-xl border px-3 py-3 text-sm font-medium transition-all disabled:opacity-40 ${color} ${
                suggestedRating === rating ? "ring-2 ring-offset-1 ring-violet-400" : ""
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
