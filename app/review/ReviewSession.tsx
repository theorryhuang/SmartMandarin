"use client";

import { useState } from "react";
import { ReviewCard } from "@/components/ReviewCard";
import type { VocabularyMastery } from "@/lib/types";

interface Props {
  initialCards: VocabularyMastery[];
}

export function ReviewSession({ initialCards }: Props) {
  const [cards, setCards] = useState(initialCards);
  const [index, setIndex] = useState(0);
  const [sessionResults, setSessionResults] = useState<
    { hanzi: string; stability: number }[]
  >([]);

  const current = cards[index];
  const done = index >= cards.length;

  function handleNext(result: { stability: number; next_review: string }) {
    if (current) {
      setSessionResults((prev) => [
        ...prev,
        { hanzi: current.hanzi, stability: result.stability },
      ]);
    }
    setIndex((i) => i + 1);
  }

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="text-4xl">🎉</span>
        <h2 className="text-xl font-medium">No cards due</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          Come back later or start a conversation to encounter new words.
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-6 text-center max-w-sm">
        <h2 className="text-2xl font-medium">Session complete</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          {sessionResults.length} card{sessionResults.length !== 1 ? "s" : ""} reviewed
        </p>
        <div className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] divide-y divide-[var(--color-border)]">
          {sessionResults.map((r) => (
            <div key={r.hanzi} className="flex justify-between px-4 py-2 text-sm">
              <span>{r.hanzi}</span>
              <span className="text-[var(--color-text-muted)]">
                S: {r.stability.toFixed(1)}d
              </span>
            </div>
          ))}
        </div>
        <a
          href="/"
          className="text-sm text-violet-400 hover:text-violet-300 transition-colors"
        >
          Back to home
        </a>
      </div>
    );
  }

  return (
    <ReviewCard
      card={current}
      onNext={handleNext}
      queueRemaining={cards.length - index}
    />
  );
}
