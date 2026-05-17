"use client";

import { useState, useTransition } from "react";
import { ReviewSession } from "./ReviewSession";
import {
  getDueWords,
  getDueSlangWords,
  getDueWordsByLastRating,
  getAllWords,
  getAllSlangWords,
  getWordsByHSKRange,
  getUnreviewedWords,
} from "@/app/actions/vocabulary";
import type { VocabularyMastery } from "@/lib/types";
import { useLanguage } from "@/app/_components/LanguageContext";

type Step = "main" | "by_mastery" | "by_hsk";

interface Props {
  isSlang?: boolean;
}

const HSK_LEVELS = [
  { label: "HSK 1", min: 1, max: 2 },
  { label: "HSK 2", min: 2, max: 3 },
  { label: "HSK 3", min: 3, max: 4 },
  { label: "HSK 4", min: 4, max: 5 },
  { label: "HSK 5", min: 5, max: 6 },
  { label: "HSK 6", min: 6, max: 7 },
  { label: "HSK 7+", min: 7, max: undefined },
];

export function ReviewFilterPicker({ isSlang = false }: Props) {
  const { t } = useLanguage();
  const [step, setStep] = useState<Step>("main");
  const [cards, setCards] = useState<VocabularyMastery[] | null>(null);
  const [sessionKey, setSessionKey] = useState("");
  const [isPending, startTransition] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  function load(key: string, fn: () => Promise<VocabularyMastery[]>, includeGetAll = false) {
    setPendingKey(key);
    startTransition(async () => {
      const result = await fn();
      setSessionKey(key);
      setCards(result);
      setPendingKey(null);
    });
  }

  if (cards !== null) {
    const getAllFn = isSlang ? getAllSlangWords : getAllWords;
    return (
      <ReviewSession
        initialCards={cards}
        sessionKey={sessionKey}
        getAllWordsFn={sessionKey.endsWith("_all") ? getAllFn : undefined}
      />
    );
  }

  // ── By Mastery sub-picker ──────────────────────────────────────────────────
  if (step === "by_mastery") {
    const masteryOptions = [
      {
        key: "mastery_hard",
        label: t.filterHard,
        desc: t.filterHardDesc,
        color: "border-orange-200 bg-orange-50 hover:bg-orange-100 text-orange-700",
        fn: () => getDueWordsByLastRating([2], isSlang, 200),
      },
      {
        key: "mastery_hard_good",
        label: t.filterHardGood,
        desc: t.filterHardGoodDesc,
        color: "border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700",
        fn: () => getDueWordsByLastRating([2, 3], isSlang, 200),
      },
      {
        key: "mastery_good",
        label: t.filterGood,
        desc: t.filterGoodDesc,
        color: "border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-700",
        fn: () => getDueWordsByLastRating([3], isSlang, 200),
      },
    ];

    return (
      <div className="flex flex-col items-center gap-6 text-center max-w-sm w-full">
        <button
          onClick={() => setStep("main")}
          className="self-start text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          ← {t.back}
        </button>
        <h2 className="text-xl font-medium">{t.filterByMastery}</h2>
        <div className="flex flex-col gap-3 w-full">
          {masteryOptions.map((opt) => (
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

  // ── By HSK sub-picker ──────────────────────────────────────────────────────
  if (step === "by_hsk") {
    return (
      <div className="flex flex-col items-center gap-6 text-center max-w-sm w-full">
        <button
          onClick={() => setStep("main")}
          className="self-start text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          ← {t.back}
        </button>
        <h2 className="text-xl font-medium">{t.selectHSKLevel}</h2>
        <div className="grid grid-cols-3 gap-3 w-full">
          {HSK_LEVELS.map((lvl) => (
            <button
              key={lvl.label}
              onClick={() => load(`hsk_${lvl.min}`, () => getWordsByHSKRange(lvl.min, lvl.max))}
              disabled={isPending}
              className="rounded-xl border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700 px-4 py-5 font-semibold text-base transition-colors disabled:opacity-50 relative"
            >
              {lvl.label}
              {isPending && pendingKey === `hsk_${lvl.min}` && (
                <span className="absolute bottom-1.5 left-0 right-0 text-[10px] opacity-60">{t.loading}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Main picker ────────────────────────────────────────────────────────────
  const mainOptions = [
    {
      key: "main_by_hsk",
      label: t.filterByHSK,
      desc: t.filterByHSKDesc,
      color: "border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700",
      action: () => setStep("by_hsk"),
    },
    {
      key: "main_by_mastery",
      label: t.filterByMastery,
      desc: t.filterByMasteryDesc,
      color: "border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700",
      action: () => setStep("by_mastery"),
    },
    {
      key: "main_unreviewed",
      label: t.filterUnreviewed,
      desc: t.filterUnreviewedDesc,
      color: "border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700",
      action: () => load("unreviewed", () => getUnreviewedWords(200)),
    },
    {
      key: "main_all",
      label: t.filterAll,
      desc: t.filterAllDesc,
      color: "border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-700",
      action: () => load("main_all", () => isSlang ? getDueSlangWords(100) : getDueWords(100), true),
    },
  ];

  return (
    <div className="flex flex-col items-center gap-6 text-center max-w-sm w-full">
      <h2 className="text-xl font-medium">{t.filterTitle}</h2>
      <div className="flex flex-col gap-3 w-full">
        {mainOptions.map((opt) => (
          <button
            key={opt.key}
            onClick={opt.action}
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
