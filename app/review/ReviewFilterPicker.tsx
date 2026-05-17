"use client";

import { useState, useTransition } from "react";
import { ReviewSession } from "./ReviewSession";
import {
  getDueWords,
  getDueWordsByLastRating,
  getAllWords,
  getWordsByHSKRange,
  getUnreviewedWords,
} from "@/app/actions/vocabulary";
import type { VocabularyMastery } from "@/lib/types";
import { useLanguage } from "@/app/_components/LanguageContext";

interface HSKLevel {
  label: string;
  min?: number;
  max?: number;
}

const HSK_LEVELS: HSKLevel[] = [
  { label: "HSK 1", min: 1, max: 2 },
  { label: "HSK 2", min: 2, max: 3 },
  { label: "HSK 3", min: 3, max: 4 },
  { label: "HSK 4", min: 4, max: 5 },
  { label: "HSK 5", min: 5, max: 6 },
  { label: "HSK 6", min: 6, max: 7 },
  { label: "HSK 7+", min: 7, max: undefined },
  { label: "All Words", min: undefined, max: undefined },
];

interface Props {
  isSlang?: boolean;
}

export function ReviewFilterPicker({ isSlang = false }: Props) {
  const { t } = useLanguage();
  const [selectedHSK, setSelectedHSK] = useState<HSKLevel | null>(null);
  const [cards, setCards] = useState<VocabularyMastery[] | null>(null);
  const [sessionKey, setSessionKey] = useState("");
  const [isPending, startTransition] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  function load(key: string, fn: () => Promise<VocabularyMastery[]>) {
    setPendingKey(key);
    startTransition(async () => {
      const result = await fn();
      setSessionKey(key);
      setCards(result);
      setPendingKey(null);
    });
  }

  if (cards !== null) {
    return (
      <ReviewSession
        initialCards={cards}
        sessionKey={sessionKey}
        getAllWordsFn={sessionKey.endsWith("_all") ? (selectedHSK?.min !== undefined ? () => getWordsByHSKRange(selectedHSK.min!, selectedHSK.max) : getAllWords) : undefined}
      />
    );
  }

  // ── Filter sub-picker (after HSK level chosen) ─────────────────────────────
  if (selectedHSK !== null) {
    const { min, max } = selectedHSK;
    const filterKey = selectedHSK.label.replace(/\s/g, "_").toLowerCase();

    const filterOptions = [
      {
        key: `${filterKey}_hard`,
        label: t.filterHard,
        desc: t.filterHardDesc,
        color: "border-orange-200 bg-orange-50 hover:bg-orange-100 text-orange-700",
        fn: () => getDueWordsByLastRating([2], isSlang, 200, min, max),
      },
      {
        key: `${filterKey}_easy`,
        label: t.filterEasy,
        desc: t.filterEasyDesc,
        color: "border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700",
        fn: () => getDueWordsByLastRating([3, 4], isSlang, 200, min, max),
      },
      {
        key: `${filterKey}_hardeasy`,
        label: t.filterHardEasy,
        desc: t.filterHardEasyDesc,
        color: "border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700",
        fn: () => getDueWordsByLastRating([2, 3, 4], isSlang, 200, min, max),
      },
      {
        key: `${filterKey}_new`,
        label: t.filterUnreviewed,
        desc: t.filterUnreviewedDesc,
        color: "border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700",
        fn: () => getUnreviewedWords(200, min, max),
      },
      {
        key: `${filterKey}_all`,
        label: t.filterAll,
        desc: t.filterAllDesc,
        color: "border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-700",
        fn: () =>
          min !== undefined
            ? getWordsByHSKRange(min, max, 200)
            : getAllWords(200),
      },
    ];

    return (
      <div className="flex flex-col items-center gap-6 text-center max-w-sm w-full">
        <button
          onClick={() => setSelectedHSK(null)}
          className="self-start text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          ← {t.back}
        </button>
        <h2 className="text-xl font-medium">{selectedHSK.label}</h2>
        <div className="flex flex-col gap-3 w-full">
          {filterOptions.map((opt) => (
            <button
              key={opt.key}
              onClick={() => load(opt.key, opt.fn)}
              disabled={isPending}
              className={`w-full rounded-xl border px-5 py-4 text-left transition-colors disabled:opacity-50 ${opt.color}`}
            >
              <div className="font-medium text-base">{opt.label}</div>
              <div className="text-sm opacity-70 mt-0.5">{opt.desc}</div>
              {isPending && pendingKey === opt.key && (
                <div className="text-xs opacity-60 mt-1">{t.loading}</div>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── HSK level picker (main) ────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center gap-6 text-center max-w-sm w-full">
      <h2 className="text-xl font-medium">{t.filterTitle}</h2>
      <div className="grid grid-cols-2 gap-3 w-full">
        {HSK_LEVELS.map((lvl) => (
          <button
            key={lvl.label}
            onClick={() => setSelectedHSK(lvl)}
            className="rounded-xl border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700 px-4 py-5 font-semibold text-base transition-colors"
          >
            {lvl.label === "All Words" ? t.filterAll : lvl.label}
          </button>
        ))}
      </div>
    </div>
  );
}
