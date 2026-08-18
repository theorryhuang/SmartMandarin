"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Flame } from "lucide-react";
import type { DailyStreak } from "@/lib/types";
import { useLanguage } from "@/app/_components/LanguageContext";

interface Props {
  streak: DailyStreak;
}

/** YYYY-MM-DD for a given year/month(0-11)/day, no timezone conversion. */
function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function StreakCalendar({ streak }: Props) {
  const { t, lang } = useLanguage();
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-11

  const activeSet = new Set(streak.activeDates);
  const todayStr = ymd(today.getFullYear(), today.getMonth(), today.getDate());

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay(); // Sun = 0

  const cells: (number | null)[] = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  // Locale passed explicitly, not `undefined` — `undefined` resolves to the
  // *environment's* default locale, which is the Node server's (English)
  // during SSR but the browser's (whatever the user's OS is set to, often
  // not English) on the client. Those can disagree ("August 2026" vs
  // "2026年8月"), which is a hydration mismatch. Tying it to the app's own
  // language setting keeps server and client rendering the same string
  // regardless of either environment's ambient locale.
  const monthLabel = firstOfMonth.toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", {
    month: "long",
    year: "numeric",
  });

  // Don't let navigation go past the current month, or before the user's
  // first-ever active day (nothing to show, and it'd wander forever).
  const canGoNext = viewYear < today.getFullYear() || (viewYear === today.getFullYear() && viewMonth < today.getMonth());
  const earliestDate = streak.activeDates[0];
  const canGoPrev =
    !earliestDate ||
    viewYear > Number(earliestDate.slice(0, 4)) ||
    (viewYear === Number(earliestDate.slice(0, 4)) && viewMonth > Number(earliestDate.slice(5, 7)) - 1);

  function shiftMonth(delta: number) {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  }

  return (
    <div className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1">
          <Flame size={14} className={streak.current > 0 ? "text-amber-500" : "text-[var(--color-text-muted)]"} />
          <span className="text-xs font-medium">
            {streak.current > 0 ? t.dailyStreakDays(streak.current) : t.dailyStreakNone}
          </span>
        </div>
        {streak.longest > 0 && (
          <span className="text-[11px] text-[var(--color-text-muted)]">{t.dailyStreakBest(streak.longest)}</span>
        )}
      </div>

      <div className="flex items-center justify-between mb-1">
        <button
          onClick={() => shiftMonth(-1)}
          disabled={!canGoPrev}
          className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:opacity-30 transition-colors"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">{monthLabel}</span>
        <button
          onClick={() => shiftMonth(1)}
          disabled={!canGoNext}
          className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:opacity-30 transition-colors"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Capped width — an aspect-square cell at 1/7 of the full card width
          reads as an oversized tile; a narrower grid keeps each day compact. */}
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="text-[9px] text-[var(--color-text-muted)] py-0.5">
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={i} />;
          const dateStr = ymd(viewYear, viewMonth, day);
          const active = activeSet.has(dateStr);
          const isToday = dateStr === todayStr;
          return (
            <div
              key={i}
              className={`aspect-square flex items-center justify-center rounded-md text-[10px] ${
                active
                  ? "bg-amber-500 text-white font-medium"
                  : isToday
                  ? "border border-amber-300 text-[var(--color-text-secondary)]"
                  : "text-[var(--color-text-muted)]"
              }`}
            >
              {day}
            </div>
          );
        })}
      </div>
    </div>
  );
}
