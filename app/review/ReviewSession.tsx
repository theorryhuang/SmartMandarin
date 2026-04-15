"use client";

import { useState, useTransition } from "react";
import { ReviewCard } from "@/components/ReviewCard";
import { getAllWords } from "@/app/actions/vocabulary";
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
  const [loadingMore, startLoadingMore] = useTransition();

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

  function practiceAll() {
    startLoadingMore(async () => {
      const all = await getAllWords(200);
      setCards(all);
      setIndex(0);
      setSessionResults([]);
    });
  }

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center gap-5 text-center">
        <span className="text-4xl">🎉</span>
        <h2 className="text-xl font-medium">All caught up</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          No cards due right now.
        </p>
        <button
          onClick={practiceAll}
          disabled={loadingMore}
          className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          {loadingMore ? "Loading…" : "Practice all vocabulary"}
        </button>
        <a href="/" className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors">
          Back to home
        </a>
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
        <button
          onClick={practiceAll}
          disabled={loadingMore}
          className="w-full px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          {loadingMore ? "Loading…" : "Practice all vocabulary"}
        </button>
        <a href="/" className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors">
          Back to home
        </a>
      </div>
    );
  }

  return (
    <ReviewCard
      key={current.id}
      card={current}
      onNext={handleNext}
      queueRemaining={cards.length - index}
    />
  );
}
