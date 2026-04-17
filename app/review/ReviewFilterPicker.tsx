"use client";

import { useState, useTransition } from "react";
import { ReviewSession } from "./ReviewSession";
import {
  getDueWords,
  getDueSlangWords,
  getDueWordsByLastRating,
  getAllWords,
  getAllSlangWords,
} from "@/app/actions/vocabulary";
import type { VocabularyMastery } from "@/lib/types";
import { useLanguage } from "@/app/_components/LanguageContext";

type FilterMode = "hard" | "hard_good" | "all";

interface Props {
  isSlang?: boolean;
}

export function ReviewFilterPicker({ isSlang = false }: Props) {
  const { t } = useLanguage();
  const [cards, setCards] = useState<VocabularyMastery[] | null>(null);
  const [mode, setMode] = useState<FilterMode | null>(null);
  const [isPending, startTransition] = useTransition();
  const [pendingMode, setPendingMode] = useState<FilterMode | null>(null);

  function selectFilter(m: FilterMode) {
    setPendingMode(m);
    startTransition(async () => {
      let result: VocabularyMastery[];
      if (m === "all") {
        result = isSlang ? await getDueSlangWords(100) : await getDueWords(100);
      } else {
        const ratings = m === "hard" ? [2] : [2, 3];
        result = await getDueWordsByLastRating(ratings, isSlang, 100);
      }
      setMode(m);
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
  ];

  return (
    <div className="flex flex-col items-center gap-6 text-center max-w-sm w-full">
      <h2 className="text-xl font-medium">{t.filterTitle}</h2>
      <div className="flex flex-col gap-3 w-full">
        {options.map((opt) => (
          <button
            key={opt.mode}
            onClick={() => selectFilter(opt.mode)}
            disabled={isPending}
            className={`w-full rounded-xl border px-5 py-4 text-left transition-colors disabled:opacity-50 ${opt.color}`}
          >
            <div className="font-medium text-base">{opt.label}</div>
            <div className="text-sm opacity-70 mt-0.5">{opt.desc}</div>
            {isPending && pendingMode === opt.mode && (
              <div className="text-xs opacity-60 mt-1">{t.loading}</div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
