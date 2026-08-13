"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Plus, Check, Trash2 } from "lucide-react";
import type { DictResult } from "@/lib/cedict";
import type { VocabularyMastery } from "@/lib/types";
import { hskColor } from "@/lib/hskColor";
import { deleteWord, logMistake } from "@/app/actions/vocabulary";
import { useLanguage } from "@/app/_components/LanguageContext";

interface Entry {
  pinyin: string;
  meaning: string;
  hsk_level: number | null;
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
}: {
  hanzi: string;
  entries: DictResult[];
  hskLevel: number | null;
  savedWords: VocabularyMastery[];
  selectedPinyin: string | null;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  // Keyed by senseKey() so each reading's saved row (and its own FSRS
  // progress) can be looked up and toggled independently.
  const [saved, setSaved] = useState<Map<string, VocabularyMastery>>(
    () => new Map(savedWords.map((w) => [senseKey(w), w]))
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);

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
      <div className="flex items-center gap-3 px-4 pt-[max(12px,env(safe-area-inset-top))] pb-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] sticky top-0 z-10">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          <ChevronLeft size={18} />
          <span className="text-sm">{t.back}</span>
        </button>
      </div>

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
          <div className="flex items-center justify-center py-16 text-sm text-[var(--color-text-muted)]">
            {t.wordNotInDictionary}
          </div>
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
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
