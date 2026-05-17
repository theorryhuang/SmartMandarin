"use client";

import { useState, useTransition } from "react";
import { ReviewSession } from "./ReviewSession";
import {
  getDueWords,
  getDueSlangWords,
  getDueWordsByLastRating,
  getAllWords,
  getAllSlangWords,
  getWordsByHSK,
  getWordsByMastery,
  getUnreviewedWords,
  getAvailableHSKLevels,
} from "@/app/actions/vocabulary";
import type { VocabularyMastery } from "@/lib/types";
import { useLanguage } from "@/app/_components/LanguageContext";

type FilterMode = "hard" | "hard_good" | "all" | "by_hsk" | "by_mastery" | "unreviewed";

interface Props {
  isSlang?: boolean;
}

export function ReviewFilterPicker({ isSlang = false }: Props) {
  const { t } = useLanguage();
  const [cards, setCards] = useState<VocabularyMastery[] | null>(null);
  const [mode, setMode] = useState<FilterMode | null>(null);
  const [isPending, startTransition] = useTransition();
  const [pendingMode, setPendingMode] = useState<FilterMode | null>(null);

  // HSK sub-step state
  const [hskStep, setHskStep] = useState(false);
  const [availableLevels, setAvailableLevels] = useState<number[]>([]);
  const [pendingHSK, setPendingHSK] = useState(false);

  function selectFilter(m: FilterMode) {
    if (m === "by_hsk") {
      setPendingHSK(true);
      getAvailableHSKLevels().then((levels) => {
        setAvailableLevels(levels);
        setHskStep(true);
        setPendingHSK(false);
      });
      return;
    }

    setPendingMode(m);
    startTransition(async () => {
      let result: VocabularyMastery[];
      if (m === "all") {
        result = isSlang ? await getDueSlangWords(100) : await getDueWords(100);
      } else if (m === "by_mastery") {
        result = await getWordsByMastery(200);
      } else if (m === "unreviewed") {
        result = await getUnreviewedWords(200);
      } else {
        const ratings = m === "hard" ? [2] : [2, 3];
        result = await getDueWordsByLastRating(ratings, isSlang, 100);
      }
      setMode(m);
      setCards(result);
      setPendingMode(null);
    });
  }

  function selectHSKLevel(level: number) {
    setPendingMode("by_hsk");
    startTransition(async () => {
      const result = await getWordsByHSK(level, 200);
      setMode("by_hsk");
      setCards(result);
      setPendingMode(null);
    });
  }

  if (cards !== null && mode !== null) {
    const sessionKey = isSlang
      ? `sm_review_session_slang_${mode}`
      : `sm_review_session_${mode}`;
    const getAllFn = isSlang ? getAllSlangWords : getAllWords;
    return (
      <ReviewSession
        initialCards={cards}
        sessionKey={sessionKey}
        getAllWordsFn={mode === "all" ? getAllFn : undefined}
      />
    );
  }

  // HSK level sub-picker
  if (hskStep) {
    return (
      <div className="flex flex-col items-center gap-6 text-center max-w-sm w-full">
        <button
          onClick={() => setHskStep(false)}
          className="self-start text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          ← {t.back}
        </button>
        <h2 className="text-xl font-medium">{t.selectHSKLevel}</h2>
        {availableLevels.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">{t.noCardsMatchFilter}</p>
        ) : (
          <div className="grid grid-cols-3 gap-3 w-full">
            {availableLevels.map((level) => (
              <button
                key={level}
                onClick={() => selectHSKLevel(level)}
                disabled={isPending}
                className="rounded-xl border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700 px-4 py-5 text-center font-semibold text-lg transition-colors disabled:opacity-50"
              >
                HSK {level}
              </button>
            ))}
          </div>
        )}
        {isPending && (
          <p className="text-sm text-[var(--color-text-muted)]">{t.loading}</p>
        )}
      </div>
    );
  }

  const options: { mode: FilterMode; label: string; desc: string; color: string }[] = [
    {
      mode: "hard",
      label: t.filterHard,
      desc: t.filterHardDesc,
      color: "border-orange-200 bg-orange-50 hover:bg-orange-100 text-orange-700",
    },
    {
      mode: "hard_good",
      label: t.filterHardGood,
      desc: t.filterHardGoodDesc,
      color: "border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700",
    },
    {
      mode: "all",
      label: t.filterAll,
      desc: t.filterAllDesc,
      color: "border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700",
    },
    {
      mode: "by_hsk",
      label: t.filterByHSK,
      desc: t.filterByHSKDesc,
      color: "border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-700",
    },
    {
      mode: "by_mastery",
      label: t.filterByMastery,
      desc: t.filterByMasteryDesc,
      color: "border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700",
    },
    {
      mode: "unreviewed",
      label: t.filterUnreviewed,
      desc: t.filterUnreviewedDesc,
      color: "border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700",
    },
  ];

  return (
    <div className="flex flex-col items-center gap-6 text-center max-w-sm w-full">
      <h2 className="text-xl font-medium">{t.filterTitle}</h2>
      <div className="flex flex-col gap-3 w-full">
        {options.map((opt) => (
          <button
            key={opt.mode}
            onClick={() => selectFilter(opt.mode)}
            disabled={isPending || pendingHSK}
            className={`w-full rounded-xl border px-5 py-4 text-left transition-colors disabled:opacity-50 ${opt.color}`}
          >
            <div className="font-medium text-base">{opt.label}</div>
            <div className="text-sm opacity-70 mt-0.5">{opt.desc}</div>
            {(isPending && pendingMode === opt.mode) || (pendingHSK && opt.mode === "by_hsk") ? (
              <div className="text-xs opacity-60 mt-1">{t.loading}</div>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
