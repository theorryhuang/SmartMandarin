"use client";

import { useState, useTransition, useRef } from "react";
import { ReviewCard } from "@/components/ReviewCard";
import { getAllWords } from "@/app/actions/vocabulary";
import type { VocabularyMastery } from "@/lib/types";
import { useLanguage } from "@/app/_components/LanguageContext";

const DEFAULT_SESSION_KEY = "sm_review_session";

interface SavedSession {
  cards: VocabularyMastery[];
  index: number;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function saveSession(key: string, cards: VocabularyMastery[], index: number) {
  try {
    localStorage.setItem(key, JSON.stringify({ cards, index }));
  } catch {}
}

function clearSession(key: string) {
  try { localStorage.removeItem(key); } catch {}
}

function initSession(key: string, incoming: VocabularyMastery[]): {
  ordered: VocabularyMastery[];
  startIndex: number;
} {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const saved: SavedSession = JSON.parse(raw);
      if (saved.cards?.length > 0 && saved.index < saved.cards.length) {
        return { ordered: saved.cards, startIndex: saved.index };
      }
    }
  } catch {}

  // Fresh shuffle
  const ordered = shuffle(incoming);
  saveSession(key, ordered, 0);
  return { ordered, startIndex: 0 };
}

interface Props {
  initialCards: VocabularyMastery[];
  sessionKey?: string;
  getAllWordsFn?: () => Promise<VocabularyMastery[]>;
}

export function ReviewSession({ initialCards, sessionKey = DEFAULT_SESSION_KEY, getAllWordsFn }: Props) {
  const { t } = useLanguage();
  const activeKeyRef = useRef(sessionKey);

  const [{ cards, index }, setSession] = useState(() => {
    const { ordered, startIndex } = initSession(sessionKey, initialCards);
    return { cards: ordered, index: startIndex };
  });

  const [sessionResults, setSessionResults] = useState<
    { hanzi: string; stability: number }[]
  >([]);
  const [history, setHistory] = useState<{ cards: VocabularyMastery[]; index: number }[]>([]);
  const [loadingMore, startLoadingMore] = useTransition();

  const current = cards[index];
  const done = index >= cards.length;

  function handleNext(result: { stability: number; difficulty: number; next_review: string }) {
    if (current) {
      setSessionResults((prev) => [
        ...prev,
        { hanzi: current.hanzi, stability: result.stability },
      ]);
    }
    // Snapshot current state before advancing so we can go back
    setHistory((h) => [...h, { cards, index }]);
    setSession((s) => {
      const next = s.index + 1;
      const updatedCards = s.cards.map((c, i) =>
        i === s.index
          ? { ...c, stability: result.stability, difficulty: result.difficulty }
          : c
      );
      saveSession(activeKeyRef.current, updatedCards, next);
      return { cards: updatedCards, index: next };
    });
  }

  function handleBack() {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setSessionResults((r) => r.slice(0, -1));
    setSession({ cards: prev.cards, index: prev.index });
    saveSession(activeKeyRef.current, prev.cards, prev.index);
  }

  function handleRestart() {
    setSession({ cards, index: 0 });
    setHistory([]);
    setSessionResults([]);
    saveSession(activeKeyRef.current, cards, 0);
  }

  function handleReshuffle() {
    setSession((s) => {
      const reviewed = s.cards.slice(0, s.index);
      const remaining = shuffle(s.cards.slice(s.index));
      const reshuffled = [...reviewed, ...remaining];
      saveSession(activeKeyRef.current, reshuffled, s.index);
      return { cards: reshuffled, index: s.index };
    });
  }

  function practiceAll() {
    startLoadingMore(async () => {
      const all = await (getAllWordsFn ?? getAllWords)(200);
      clearSession(sessionKey);
      const ordered = shuffle(all);
      activeKeyRef.current = DEFAULT_SESSION_KEY;
      saveSession(DEFAULT_SESSION_KEY, ordered, 0);
      setSession({ cards: ordered, index: 0 });
      setSessionResults([]);
    });
  }

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center gap-5 text-center">
        <span className="text-4xl">🎉</span>
        <h2 className="text-xl font-medium">{t.allCaughtUp}</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          {t.noCardsDue}
        </p>
        <button
          onClick={practiceAll}
          disabled={loadingMore}
          className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          {loadingMore ? t.loading : t.practiceAll}
        </button>
        <a href="/" className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors">
          {t.backToHome}
        </a>
      </div>
    );
  }

  if (done) {
    clearSession(sessionKey);
    return (
      <div className="flex flex-col items-center gap-6 text-center max-w-sm">
        <h2 className="text-2xl font-medium">{t.sessionComplete}</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          {t.cardsReviewed(sessionResults.length)}
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
          {loadingMore ? t.loading : t.practiceAll}
        </button>
        <a href="/" className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors">
          {t.backToHome}
        </a>
      </div>
    );
  }

  return (
    <ReviewCard
      key={current.id}
      card={current}
      onNext={handleNext}
      onBack={handleBack}
      canGoBack={history.length > 0}
      onRestart={handleRestart}
      onReshuffle={handleReshuffle}
      currentIndex={index}
      totalCards={cards.length}
    />
  );
}
