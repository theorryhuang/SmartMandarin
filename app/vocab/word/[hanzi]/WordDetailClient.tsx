"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Check, Trash2, Search, RotateCcw } from "lucide-react";
import type { DictResult } from "@/lib/cedict";
import type { VocabularyMastery } from "@/lib/types";
import { hskColor } from "@/lib/hskColor";
import { deleteWord, logMistake } from "@/app/actions/vocabulary";
import { resetDailyLearned } from "@/app/actions/dailyLearning";
import { useLanguage } from "@/app/_components/LanguageContext";

interface Entry {
  pinyin: string;
  meaning: string;
  hsk_level: number | null;
}

interface BreakdownPart {
  word: string;
  entries: Entry[];
}

/** Fixed, non-locale-dependent format — `toLocaleDateString()` with no
 *  locale arg picks up the runtime's default, which differs between the
 *  Node SSR pass and the browser and causes a hydration mismatch. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** Identity for a sense: pinyin alone can collide (CEDICT sometimes lists
 *  distinct senses under the same reading — 打 dǎ "to hit" vs "dozen"). */
function senseKey(e: { pinyin: string; meaning: string }): string {
  return e.pinyin + "\u0001" + e.meaning;
}

export function WordDetailClient({
  hanzi,
  entries,
  hskLevel,
  savedWords,
  selectedPinyin,
  breakdown,
}: {
  hanzi: string;
  entries: DictResult[];
  hskLevel: number | null;
  savedWords: VocabularyMastery[];
  selectedPinyin: string | null;
  /** Set when `hanzi` isn't itself a CEDICT headword but decomposes into real
   *  ones (e.g. a raw multi-char selection dragged from the popup/extension) —
   *  lets the user pick an individual sub-word instead of hitting a dead end. */
  breakdown: BreakdownPart[] | null;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  // Keyed by senseKey() so each reading's saved row (and its own FSRS
  // progress) can be looked up and toggled independently.
  const [saved, setSaved] = useState<Map<string, VocabularyMastery>>(
    () => new Map(savedWords.map((w) => [senseKey(w), w]))
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [busyDailyKey, setBusyDailyKey] = useState<string | null>(null);
  // Ephemeral, per-sense "just added" state for breakdown parts — these are
  // different words than `hanzi` itself, so there's no pre-fetched saved-state
  // for them (same lightweight pattern as the search page's addedSet).
  const [addedBreakdown, setAddedBreakdown] = useState<Set<string>>(new Set());
  const [busyBreakdownKey, setBusyBreakdownKey] = useState<string | null>(null);

  const c = hskColor(hskLevel);

  // Union of CEDICT's entries and any saved sense CEDICT didn't mention
  // (AI/slang defs, or a custom word with no dictionary entry at all).
  const cedictKeys = new Set(entries.map((e) => senseKey(e)));
  const displayEntries: Entry[] = [
    ...entries.map((e) => ({ pinyin: e.pinyin, meaning: e.meaning, hsk_level: e.hsk_level })),
    ...[...saved.values()]
      .filter((w) => !cedictKeys.has(senseKey(w)))
      .map((w) => ({ pinyin: w.pinyin, meaning: w.meaning, hsk_level: w.hsk_level })),
  ];

  async function handleAdd(entry: Entry) {
    const key = senseKey(entry);
    setBusyKey(key);
    try {
      await logMistake(hanzi, {
        pinyin: entry.pinyin,
        meaning: entry.meaning,
        hsk_level: entry.hsk_level ?? undefined,
      });
      setSaved((prev) => {
        const next = new Map(prev);
        next.set(key, {
          id: "",
          user_id: "",
          hanzi,
          pinyin: entry.pinyin,
          meaning: entry.meaning,
          hsk_level: entry.hsk_level,
          stability: 0,
          difficulty: 0,
          last_reviewed: null,
          next_review: null,
          review_count: 0,
          is_slang: false,
          flagged_for_immediate_use: true,
          daily_learned: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        return next;
      });
      router.refresh();
    } finally {
      setBusyKey(null);
    }
  }

  async function handleAddBreakdown(word: string, entry: Entry) {
    const key = word + "|" + senseKey(entry);
    setBusyBreakdownKey(key);
    try {
      await logMistake(word, {
        pinyin: entry.pinyin,
        meaning: entry.meaning,
        hsk_level: entry.hsk_level ?? undefined,
      });
      setAddedBreakdown((prev) => new Set(prev).add(key));
    } finally {
      setBusyBreakdownKey(null);
    }
  }

  async function handleResetDaily(entry: Entry) {
    const key = senseKey(entry);
    const row = saved.get(key);
    if (!row?.id) return;
    setBusyDailyKey(key);
    try {
      await resetDailyLearned(row.id);
      setSaved((prev) => {
        const next = new Map(prev);
        const current = next.get(key);
        if (current) next.set(key, { ...current, daily_learned: false });
        return next;
      });
    } finally {
      setBusyDailyKey(null);
    }
  }

  async function handleRemove(entry: Entry) {
    const key = senseKey(entry);
    const row = saved.get(key);
    setBusyKey(key);
    try {
      await deleteWord(row?.id || hanzi, entry.pinyin, entry.meaning);
      setSaved((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      router.refresh();
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="pb-10">
      <div className="px-4 pt-6 flex flex-col items-center text-center">
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${c.bg} ${c.text}`}>
          {hskLevel !== null ? `HSK ${hskLevel}` : "—"}
        </span>
        <div className="text-5xl font-medium text-[var(--color-text-primary)] mt-3">{hanzi}</div>
        {selectedPinyin && (
          <div className="text-sm text-[var(--color-text-muted)] mt-2">{selectedPinyin}</div>
        )}
      </div>

      <div className="px-4 mt-8">
        {displayEntries.length === 0 ? (
          breakdown ? (
            <div className="flex flex-col gap-4">
              <div className="text-sm text-[var(--color-text-muted)]">{t.wordBreakdownIntro}</div>
              <div className="flex flex-col gap-3">
                {breakdown.map((part) =>
                  part.entries.length === 0 ? (
                    <div key={part.word} className="rounded-xl border border-[var(--color-border)] p-3.5">
                      <div className="text-lg font-medium text-[var(--color-text-primary)]">{part.word}</div>
                      <div className="text-sm text-[var(--color-text-muted)] italic mt-1">{t.wordNotInDictionary}</div>
                    </div>
                  ) : (
                    part.entries.map((entry) => {
                      const key = part.word + "|" + senseKey(entry);
                      const added = addedBreakdown.has(key);
                      const busy = busyBreakdownKey === key;
                      return (
                        <div key={key} className="rounded-xl border border-[var(--color-border)] p-3.5">
                          <div className="flex items-start justify-between gap-3">
                            <Link href={`/vocab/word/${encodeURIComponent(part.word)}?pinyin=${encodeURIComponent(entry.pinyin)}`} className="min-w-0">
                              <div className="text-lg font-medium text-[var(--color-text-primary)]">{part.word}</div>
                              <div className="text-sm font-medium text-[var(--color-text-primary)] mt-1">{entry.pinyin}</div>
                              <div className="text-sm text-[var(--color-text-secondary)] leading-relaxed mt-1 whitespace-pre-wrap">
                                {entry.meaning}
                              </div>
                            </Link>
                            {added ? (
                              <div className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 text-xs font-medium">
                                <Check size={13} />
                              </div>
                            ) : (
                              <button
                                onClick={() => handleAddBreakdown(part.word, entry)}
                                disabled={busy}
                                className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-500 text-white text-xs font-medium disabled:opacity-50"
                              >
                                <Plus size={13} />
                                {t.queueForReview}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )
                )}
              </div>
              <Link
                href={`/vocab?q=${encodeURIComponent(hanzi)}`}
                className="flex items-center justify-center gap-1.5 py-3 rounded-xl border border-[var(--color-border)] text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-violet-300 transition-colors"
              >
                <Search size={14} />
                {t.searchWholePhrase(hanzi)}
              </Link>
            </div>
          ) : (
            <div className="flex items-center justify-center py-16 text-sm text-[var(--color-text-muted)]">
              {t.wordNotInDictionary}
            </div>
          )
        ) : (
          <div className="flex flex-col gap-3">
            {displayEntries.map((entry, i) => {
              const key = senseKey(entry);
              const row = saved.get(key);
              const isSaved = !!row;
              const busy = busyKey === key;
              const isHighlighted = selectedPinyin ? entry.pinyin === selectedPinyin : i === 0;

              return (
                <div
                  key={key}
                  className={`rounded-xl border p-3.5 ${
                    isHighlighted ? "border-violet-300 bg-violet-50/50" : "border-[var(--color-border)]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--color-text-primary)]">{entry.pinyin}</div>
                      <div className="text-sm text-[var(--color-text-secondary)] leading-relaxed mt-1 whitespace-pre-wrap">
                        {entry.meaning}
                      </div>
                    </div>
                    {isSaved ? (
                      <button
                        onClick={() => handleRemove(entry)}
                        disabled={busy}
                        className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 text-xs font-medium disabled:opacity-50"
                      >
                        <Check size={13} />
                        <Trash2 size={12} className="opacity-70" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleAdd(entry)}
                        disabled={busy}
                        className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-500 text-white text-xs font-medium disabled:opacity-50"
                      >
                        <Plus size={13} />
                        {t.queueForReview}
                      </button>
                    )}
                  </div>

                  {row && (
                    <div className="mt-2.5 pt-2.5 border-t border-[var(--color-border)] flex justify-between text-xs text-[var(--color-text-muted)]">
                      <span>{t.masteryDays(Math.round(row.stability))}</span>
                      <span>{row.review_count > 0 ? t.reviewCountLabel(row.review_count) : t.notReviewedYet}</span>
                      {row.next_review && (
                        <span>{t.nextReviewLabel}: {formatDate(row.next_review)}</span>
                      )}
                    </div>
                  )}

                  {row?.daily_learned && (
                    <button
                      onClick={() => handleResetDaily(entry)}
                      disabled={busyDailyKey === key}
                      className="mt-2 flex items-center gap-1.5 text-xs text-amber-700 hover:underline disabled:opacity-50"
                    >
                      <RotateCcw size={12} />
                      {t.wordResetDailyLearned}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
