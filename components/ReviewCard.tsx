"use client";

import { useState, useTransition, useEffect } from "react";
import { submitReview } from "@/app/actions/vocabulary";
import type { VocabularyMastery, FSRSRating } from "@/lib/types";
import { forgettingCurve, HIGH_STABILITY_THRESHOLD } from "@/lib/fsrs";

interface Props {
  card: VocabularyMastery;
  onNext: (result: { stability: number; next_review: string }) => void;
  queueRemaining: number;
}

const RATINGS: { rating: FSRSRating; label: string; color: string }[] = [
  { rating: 1, label: "Again", color: "bg-red-50 hover:bg-red-100 border-red-200 text-red-600" },
  { rating: 2, label: "Hard",  color: "bg-orange-50 hover:bg-orange-100 border-orange-200 text-orange-600" },
  { rating: 3, label: "Good",  color: "bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-600" },
  { rating: 4, label: "Easy",  color: "bg-violet-50 hover:bg-violet-100 border-violet-200 text-violet-600" },
];

export function ReviewCard({ card, onNext, queueRemaining }: Props) {
  const [flipped, setFlipped] = useState(false);
  const [pending, startTransition] = useTransition();
  const [fetchedPinyin, setFetchedPinyin] = useState<string | null>(null);
  const [fetchedMeaning, setFetchedMeaning] = useState<string | null>(null);

  useEffect(() => {
    setFetchedPinyin(null);
    setFetchedMeaning(null);
    if (!card.meaning || !card.pinyin) {
      fetch("/api/define-word", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hanzi: card.hanzi, hsk_level: card.hsk_level }),
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
            <span className="text-sm text-[var(--color-text-muted)]">tap to flip</span>
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
              <span className="text-sm text-[var(--color-text-muted)] italic animate-pulse">loading…</span>
            )}
            {meaning && (
              <span className="text-base text-[var(--color-text-primary)] text-center">{meaning}</span>
            )}
            {card.is_slang && (
              <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-600 text-xs border border-violet-200">
                slang
              </span>
            )}
          </div>
        </div>
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
          Show answer
        </button>
      )}
    </div>
  );
}
