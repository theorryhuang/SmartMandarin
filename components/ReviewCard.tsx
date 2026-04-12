"use client";

import { useState, useTransition } from "react";
import { submitReview } from "@/app/actions/vocabulary";
import type { VocabularyMastery, FSRSRating } from "@/lib/types";
import { forgettingCurve, HIGH_STABILITY_THRESHOLD } from "@/lib/fsrs";

interface Props {
  card: VocabularyMastery;
  onNext: (result: { stability: number; next_review: string }) => void;
  queueRemaining: number;
}

const RATINGS: { rating: FSRSRating; label: string; sublabel: string; color: string }[] = [
  { rating: 1, label: "Again", sublabel: "< 1 day",  color: "bg-red-900/40 hover:bg-red-800/60 border-red-800/50 text-red-300" },
  { rating: 2, label: "Hard",  sublabel: "~1–2 days", color: "bg-orange-900/40 hover:bg-orange-800/60 border-orange-800/50 text-orange-300" },
  { rating: 3, label: "Good",  sublabel: "calculated", color: "bg-emerald-900/40 hover:bg-emerald-800/60 border-emerald-800/50 text-emerald-300" },
  { rating: 4, label: "Easy",  sublabel: "longest",  color: "bg-violet-900/40 hover:bg-violet-800/60 border-violet-800/50 text-violet-300" },
];

export function ReviewCard({ card, onNext, queueRemaining }: Props) {
  const [revealed, setRevealed] = useState(false);
  const [pending, startTransition] = useTransition();

  const elapsedDays = card.last_reviewed
    ? (Date.now() - new Date(card.last_reviewed).getTime()) / 86_400_000
    : 0;
  const retrievability = card.stability > 0
    ? forgettingCurve(elapsedDays, card.stability)
    : 1;
  const masteryPct = Math.min(card.stability / HIGH_STABILITY_THRESHOLD, 1);

  function rate(rating: FSRSRating) {
    startTransition(async () => {
      const result = await submitReview(card.id, rating, "review_session");
      onNext(result);
    });
  }

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-md">
      {/* Queue counter */}
      <p className="text-sm text-[var(--color-text-muted)]">
        {queueRemaining} card{queueRemaining !== 1 ? "s" : ""} remaining
      </p>

      {/* Card face */}
      <div
        className="w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 flex flex-col items-center gap-4 min-h-[220px] cursor-pointer select-none transition-colors hover:border-[var(--color-border-subtle)]"
        onClick={() => !revealed && setRevealed(true)}
      >
        <span className="text-6xl font-light tracking-widest">{card.hanzi}</span>

        {revealed ? (
          <div className="flex flex-col items-center gap-2 mt-2">
            <span className="text-lg text-[var(--color-text-secondary)]">{card.pinyin}</span>
            <span className="text-base text-[var(--color-text-primary)]">{card.meaning}</span>
            {card.is_slang && (
              <span className="mt-1 px-2 py-0.5 rounded-full bg-violet-900/40 text-violet-300 text-xs border border-violet-800/40">
                slang
              </span>
            )}
          </div>
        ) : (
          <span className="text-sm text-[var(--color-text-muted)] mt-auto">
            tap to reveal
          </span>
        )}
      </div>

      {/* Stats bar */}
      <div className="w-full flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
        <div className="flex-1">
          <div className="flex justify-between mb-1">
            <span>mastery</span>
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
        HSK {card.hsk_level.toFixed(1)}
        {card.review_count > 0 && <span className="ml-2">· {card.review_count} reviews</span>}
      </div>

      {/* Rating buttons — only show after reveal */}
      {revealed && (
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
      )}

      {!revealed && (
        <button
          onClick={() => setRevealed(true)}
          className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-3 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          Show answer
        </button>
      )}
    </div>
  );
}
