"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Home } from "lucide-react";
import { ReviewSession } from "./ReviewSession";
import {
  getDueWordsByLastRating,
  getAllWords,
  getWordsByHSKRange,
  getNoHSKWords,
  getUnreviewedWords,
} from "@/app/actions/vocabulary";
import type { VocabularyMastery } from "@/lib/types";
import { useLanguage } from "@/app/_components/LanguageContext";

interface HSKLevel {
  label: string;
  min?: number;
  max?: number;
  noHSK?: boolean;
  /** Slang words aren't leveled by HSK — this tile scopes to is_slang=true
   *  instead, and is mutually exclusive with every other tile (see toggleLevel). */
  isSlang?: boolean;
}

const HSK_LEVELS: HSKLevel[] = [
  { label: "HSK 1", min: 1, max: 2 },
  { label: "HSK 2", min: 2, max: 3 },
  { label: "HSK 3", min: 3, max: 4 },
  { label: "HSK 4", min: 4, max: 5 },
  { label: "HSK 5", min: 5, max: 6 },
  { label: "HSK 6", min: 6, max: 7 },
  { label: "HSK 7+", min: 7, max: undefined },
  { label: "Non-HSK", min: undefined, max: undefined, noHSK: true },
  { label: "Slang", isSlang: true },
  { label: "All Words", min: undefined, max: undefined },
];

function mergeDeduped(arrays: VocabularyMastery[][]): VocabularyMastery[] {
  const seen = new Set<string>();
  return arrays.flat().filter((w) => {
    if (seen.has(w.id)) return false;
    seen.add(w.id);
    return true;
  });
}

function NavHeader({
  onBack,
  onHome,
}: {
  onBack: () => void;
  onHome: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div
      className="px-5 pb-3"
      style={{ paddingTop: "max(20px, env(safe-area-inset-top))" }}
    >
      <div className="flex items-center justify-between max-w-sm mx-auto">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          <ChevronLeft size={18} />
          {t.back}
        </button>
        <button
          onClick={onHome}
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          <Home size={18} />
        </button>
      </div>
    </div>
  );
}

export function ReviewFilterPicker() {
  const { t } = useLanguage();
  const router = useRouter();
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(() => new Set());
  const [showSubFilter, setShowSubFilter] = useState(false);
  const [cards, setCards] = useState<VocabularyMastery[] | null>(null);
  const [sessionKey, setSessionKey] = useState("");
  const [isPending, startTransition] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const activeHSKs = HSK_LEVELS.filter((l) => selectedLabels.has(l.label));
  // Slang words aren't leveled by HSK (is_slang rows are almost always
  // hsk_level null — see slangBankLookup in lib/defineWord.ts, which only
  // gets a level by coincidental overlap with the HSK wordlist), so the
  // "Slang" tile is exclusive with every other tile (see toggleLevel) —
  // activeHSKs is always either [Slang] or a set of non-slang tiles, never both.
  const isSlangSession = activeHSKs.some((l) => l.isSlang);

  function toggleLevel(lvl: HSKLevel) {
    setSelectedLabels((prev) => {
      const next = new Set(prev);
      if (next.has(lvl.label)) {
        next.delete(lvl.label);
      } else {
        // "All Words" pulls the whole account with no HSK filter, and "Slang"
        // is a wholly separate pool — mixing either with a specific level
        // would silently inflate/mix results (fetchMerged calls getAllWords()
        // for "All Words"), so keep both exclusive of everything else.
        if (lvl.label === "All Words" || lvl.isSlang) next.clear();
        else {
          next.delete("All Words");
          next.delete("Slang");
        }
        next.add(lvl.label);
      }
      return next;
    });
  }

  function load(key: string, fn: () => Promise<VocabularyMastery[]>) {
    setPendingKey(key);
    startTransition(async () => {
      const result = await fn();
      setSessionKey(key);
      setCards(result);
      setPendingKey(null);
    });
  }

  async function fetchMerged(
    perLevel: (lvl: HSKLevel) => Promise<VocabularyMastery[]>
  ): Promise<VocabularyMastery[]> {
    const results = await Promise.all(activeHSKs.map(perLevel));
    return mergeDeduped(results);
  }

  if (cards !== null) {
    const isAllSession = sessionKey.endsWith("_all");
    // Always scoped to isSlangSession, even outside an "_all" session — this
    // backs the "practice all" fallback button, which must stay in the same
    // slang/non-slang pool the session was started in (see getAllWords()).
    const getAllWordsFn = isAllSession
      ? () =>
          fetchMerged((lvl) =>
            lvl.noHSK
              ? getNoHSKWords(200, isSlangSession)
              : lvl.min !== undefined
              ? getWordsByHSKRange(lvl.min, lvl.max, 200, isSlangSession)
              : getAllWords(200, isSlangSession)
          )
      : () => getAllWords(200, isSlangSession);
    return (
      <ReviewSession
        initialCards={cards}
        sessionKey={sessionKey}
        getAllWordsFn={getAllWordsFn}
        onExit={() => setCards(null)}
        onHome={() => router.push("/")}
      />
    );
  }

  // ── Filter sub-picker ──────────────────────────────────────────────────────
  if (showSubFilter) {
    const filterKey = [...selectedLabels]
      .join("_")
      .replace(/\s+/g, "_")
      .toLowerCase();
    const limitPerLevel = Math.max(50, Math.ceil(200 / activeHSKs.length));

    const subtitle = activeHSKs
      .map((l) =>
        l.label === "All Words"
          ? t.filterAll
          : l.label === "Non-HSK"
          ? t.filterNonHSK
          : l.isSlang
          ? t.slang
          : l.label
      )
      .join(" + ");

    const filterOptions = [
      {
        key: `${filterKey}_hard`,
        label: t.filterHard,
        desc: t.filterHardDesc,
        color: "border-orange-200 bg-orange-50 hover:bg-orange-100 text-orange-700",
        fn: () =>
          fetchMerged((lvl) =>
            getDueWordsByLastRating([2], isSlangSession, limitPerLevel, lvl.min, lvl.max, lvl.noHSK)
          ),
      },
      {
        key: `${filterKey}_easy`,
        label: t.filterEasy,
        desc: t.filterEasyDesc,
        color: "border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700",
        fn: () =>
          fetchMerged((lvl) =>
            getDueWordsByLastRating([3], isSlangSession, limitPerLevel, lvl.min, lvl.max, lvl.noHSK)
          ),
      },
      {
        key: `${filterKey}_hardeasy`,
        label: t.filterHardEasy,
        desc: t.filterHardEasyDesc,
        color: "border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700",
        fn: () =>
          fetchMerged((lvl) =>
            getDueWordsByLastRating([2, 3], isSlangSession, limitPerLevel, lvl.min, lvl.max, lvl.noHSK)
          ),
      },
      {
        key: `${filterKey}_new`,
        label: t.filterUnreviewed,
        desc: t.filterUnreviewedDesc,
        color: "border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700",
        fn: () =>
          fetchMerged((lvl) =>
            getUnreviewedWords(limitPerLevel, lvl.min, lvl.max, lvl.noHSK, isSlangSession)
          ),
      },
      {
        key: `${filterKey}_all`,
        label: t.filterAll,
        desc: t.filterAllDesc,
        color: "border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-700",
        fn: () =>
          fetchMerged((lvl) =>
            lvl.noHSK
              ? getNoHSKWords(limitPerLevel, isSlangSession)
              : lvl.min !== undefined
              ? getWordsByHSKRange(lvl.min, lvl.max, limitPerLevel, isSlangSession)
              : getAllWords(limitPerLevel, isSlangSession)
          ),
      },
    ];

    return (
      <div className="flex flex-col min-h-screen">
        <NavHeader onBack={() => setShowSubFilter(false)} onHome={() => router.push("/")} />
        <div className="flex-1 flex flex-col items-center justify-center px-6 pb-6 gap-6 max-w-sm mx-auto w-full">
          <h2 className="text-xl font-medium text-center">{subtitle}</h2>
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
      </div>
    );
  }

  // ── HSK level picker (main) ────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-screen">
      <NavHeader onBack={() => router.back()} onHome={() => router.push("/")} />
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-6 gap-6 max-w-sm mx-auto w-full">
        <h2 className="text-xl font-medium text-center">{t.filterTitle}</h2>
        <div className="grid grid-cols-2 gap-3 w-full">
          {HSK_LEVELS.map((lvl) => {
            const isSelected = selectedLabels.has(lvl.label);
            return (
              <button
                key={lvl.label}
                onClick={() => toggleLevel(lvl)}
                className={`rounded-xl border px-4 py-5 font-semibold text-base transition-colors ${
                  isSelected
                    ? "border-violet-500 bg-violet-600 text-white"
                    : "border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700"
                }`}
              >
                {lvl.label === "All Words"
                  ? t.filterAll
                  : lvl.label === "Non-HSK"
                  ? t.filterNonHSK
                  : lvl.isSlang
                  ? `🔥 ${t.slang}`
                  : lvl.label}
              </button>
            );
          })}
        </div>
        {selectedLabels.size > 0 && (
          <button
            onClick={() => setShowSubFilter(true)}
            className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 text-white px-5 py-3 font-semibold text-base transition-colors"
          >
            {t.filterContinue} →
          </button>
        )}
      </div>
    </div>
  );
}
