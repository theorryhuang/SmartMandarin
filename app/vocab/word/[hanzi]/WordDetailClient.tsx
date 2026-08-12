"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Plus, Check, Trash2 } from "lucide-react";
import type { DictResult } from "@/lib/cedict";
import type { VocabularyMastery } from "@/lib/types";
import { hskColor } from "@/lib/hskColor";
import { deleteWord, logMistake } from "@/app/actions/vocabulary";
import { useLanguage } from "@/app/_components/LanguageContext";

export function WordDetailClient({
  hanzi,
  entries,
  hskLevel,
  savedWord,
  selectedPinyin,
}: {
  hanzi: string;
  entries: DictResult[];
  hskLevel: number | null;
  savedWord: VocabularyMastery | null;
  selectedPinyin: string | null;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [saved, setSaved] = useState<VocabularyMastery | null>(savedWord);
  const [busy, setBusy] = useState(false);

  const c = hskColor(hskLevel);

  // If the word isn't in cedict at all (custom-added), fall back to the
  // saved row's own pinyin/meaning so there's still something to show.
  const displayEntries: DictResult[] =
    entries.length > 0
      ? entries
      : saved
      ? [{ pinyin: saved.pinyin, meaning: saved.meaning, hsk_level: saved.hsk_level, source: "cedict" }]
      : [];

  async function handleAdd() {
    const primary = displayEntries.find((e) => e.pinyin === selectedPinyin) ?? displayEntries[0];
    if (!primary) return;
    setBusy(true);
    try {
      await logMistake(hanzi, {
        pinyin: primary.pinyin,
        meaning: primary.meaning,
        hsk_level: primary.hsk_level ?? undefined,
      });
      setSaved({
        id: "",
        user_id: "",
        hanzi,
        pinyin: primary.pinyin,
        meaning: primary.meaning,
        hsk_level: primary.hsk_level,
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
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!saved) return;
    setBusy(true);
    try {
      await deleteWord(saved.id || hanzi);
      setSaved(null);
      router.refresh();
    } finally {
      setBusy(false);
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

        <div className="mt-5 w-full max-w-xs">
          {saved ? (
            <button
              onClick={handleRemove}
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-100 text-emerald-700 text-sm font-medium disabled:opacity-50"
            >
              <Check size={15} />
              {t.wordAlreadySaved}
              <Trash2 size={14} className="ml-1 opacity-70" />
            </button>
          ) : (
            <button
              onClick={handleAdd}
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-500 text-white text-sm font-medium disabled:opacity-50"
            >
              <Plus size={15} />
              {t.addToReview}
            </button>
          )}
        </div>
      </div>

      {saved && (
        <div className="px-4 mt-6">
          <div className="text-xs font-medium text-[var(--color-text-muted)] mb-2">{t.reviewProgress}</div>
          <div className="rounded-xl border border-[var(--color-border)] p-3 space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-[var(--color-text-muted)]">{t.masteryDays(Math.round(saved.stability))}</span>
              <span className="text-[var(--color-text-secondary)]">
                {saved.review_count > 0 ? t.reviewCountLabel(saved.review_count) : t.notReviewedYet}
              </span>
            </div>
            {saved.next_review && (
              <div className="flex justify-between text-sm">
                <span className="text-[var(--color-text-muted)]">{t.nextReviewLabel}</span>
                <span className="text-[var(--color-text-secondary)]">
                  {new Date(saved.next_review).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="px-4 mt-6">
        {displayEntries.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-sm text-[var(--color-text-muted)]">
            {t.wordNotInDictionary}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {displayEntries.length > 1 && (
              <div className="text-xs font-medium text-[var(--color-text-muted)]">{t.otherReadings}</div>
            )}
            {displayEntries.map((entry, i) => {
              const isSelected = selectedPinyin ? entry.pinyin === selectedPinyin : i === 0;
              return (
                <div
                  key={entry.pinyin + i}
                  className={`rounded-xl border p-3.5 ${
                    isSelected
                      ? "border-violet-300 bg-violet-50/50"
                      : "border-[var(--color-border)]"
                  }`}
                >
                  <div className="text-sm font-medium text-[var(--color-text-primary)]">{entry.pinyin}</div>
                  <div className="text-sm text-[var(--color-text-secondary)] leading-relaxed mt-1 whitespace-pre-wrap">
                    {entry.meaning}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
