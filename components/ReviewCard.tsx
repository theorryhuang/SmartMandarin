"use client";

import { useState, useTransition, useEffect } from "react";
import { submitReview } from "@/app/actions/vocabulary";
import type { VocabularyMastery, FSRSRating } from "@/lib/types";
import { forgettingCurve, HIGH_STABILITY_THRESHOLD } from "@/lib/fsrs";
import { useLanguage } from "@/app/_components/LanguageContext";

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

export function ReviewCard({ card, onNext, onBack, canGoBack, onRestart, onReshuffle, currentIndex, totalCards }: Props) {
  const { t } = useLanguage();
  const [flipped, setFlipped] = useState(false);
  const [pending, startTransition] = useTransition();
  const [fetchedPinyin, setFetchedPinyin] = useState<string | null>(null);
  const [fetchedMeaning, setFetchedMeaning] = useState<string | null>(null);

  const RATINGS: { rating: FSRSRating; label: string; color: string }[] = [
    { rating: 1, label: t.again, color: "bg-red-50 hover:bg-red-100 border-red-200 text-red-600" },
    { rating: 2, label: t.hard,  color: "bg-orange-50 hover:bg-orange-100 border-orange-200 text-orange-600" },
    { rating: 3, label: t.good,  color: "bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-600" },
    { rating: 4, label: t.easy,  color: "bg-violet-50 hover:bg-violet-100 border-violet-200 text-violet-600" },
  ];

  useEffect(() => {
    setFetchedPinyin(null);
    setFetchedMeaning(null);
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

  const elapsedDays = card.last_reviewed
    ? (Date.now() - new Date(card.last_reviewed).getTime()) / 86_400_000
    : 0;
  const retrievability = card.stability > 0
    ? forgettingCurve(elapsedDays, card.stability)
    : 1;
  const masteryPct = Math.min(card.stability / HIGH_STABILITY_THRESHOLD, 1);

  const pinyin = card.pinyin || fetchedPinyin;
  const meaning = card.meaning || fetchedMeaning;

  function rate(rating: FSRSRating) {
    startTransition(async () => {
      try {
        const result = await submitReview(card.id, rating, "review_session");
        onNext({ stability: result.stability, difficulty: result.difficulty, next_review: result.next_review });
      } catch (err) {
        if (err instanceof Error && err.message === "WORD_DELETED") {
          // Word was deleted externally — skip it as if reviewed
          onNext({ stability: card.stability, difficulty: card.difficulty, next_review: new Date().toISOString() });
        } else {
          throw err;
        }
      }
    });
  }

  const progressPct = ((currentIndex + 1) / totalCards) * 100;

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

      {/* Flip card */}
      <div style={{ perspective: "1000px" }} className="w-full">
        <div
          style={{
            transformStyle: "preserve-3d",
            transition: "transform 0.45s cubic-bezier(0.4,0,0.2,1)",
            transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
            position: "relative",
            height: "220px",
          }}
          className="w-full cursor-pointer"
          onClick={() => !flipped && setFlipped(true)}
        >
          {/* ── Front: hanzi ── */}
          <div
            style={{ backfaceVisibility: "hidden" }}
            className="absolute inset-0 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col items-center justify-center gap-4 select-none"
          >
            <span className="text-6xl font-light tracking-widest">{card.hanzi}</span>
            <span className="text-sm text-[var(--color-text-muted)]">{t.tapToFlip}</span>
          </div>

          {/* ── Back: pinyin + meaning ── */}
          <div
            style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
            className="absolute inset-0 rounded-2xl border border-violet-200 bg-[var(--color-surface)] flex flex-col items-center justify-center gap-3 select-none px-6"
          >
            <span className="text-4xl font-light tracking-widest">{card.hanzi}</span>
            {pinyin ? (
              <span className="text-lg text-[var(--color-text-secondary)]">{pinyin}</span>
            ) : (
              <span className="text-sm text-[var(--color-text-muted)] italic animate-pulse">{t.loading}</span>
            )}
            {meaning && (
              <span className="text-base text-[var(--color-text-primary)] text-center">{meaning}</span>
            )}
            {card.is_slang && (
              <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-600 text-xs border border-violet-200">
                {t.slangBadge}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="w-full flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
        <div className="flex-1">
          <div className="flex justify-between mb-1">
            <span>{t.masteryLabel}</span>
            <span>{Math.round(masteryPct * 100)}%</span>
          </div>
          <div className="h-1 rounded-full bg-[var(--color-border)]">
            <div
              className="h-1 rounded-full bg-violet-500 transition-all"
              style={{ width: `${masteryPct * 100}%` }}
            />
          </div>
        </div>
        <div className="text-right">
          <div>R: {Math.round(retrievability * 100)}%</div>
          <div>S: {card.stability.toFixed(1)}d</div>
        </div>
      </div>

      {/* HSK level badge */}
      <div className="text-xs text-[var(--color-text-muted)]">
        {card.hsk_level !== null ? `HSK ${card.hsk_level.toFixed(1)}` : "No HSK level"}
        {card.review_count > 0 && <span className="ml-2">· {card.review_count} reviews</span>}
      </div>

      {/* Rating buttons — only after flip */}
      {flipped ? (
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
      ) : (
        <button
          onClick={() => setFlipped(true)}
          className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-3 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          {t.showAnswer}
        </button>
      )}
    </div>
  );
}
