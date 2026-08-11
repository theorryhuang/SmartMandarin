"use client";

import Link from "next/link";
import { Brain, MessageCircle, BookOpen, TrendingUp, ChevronRight, User, Mic, List, Flame } from "lucide-react";
import { useLanguage } from "./LanguageContext";
import { LanguageSwitcher } from "./LanguageSwitcher";

interface Props {
  dueCount: number;
  slangDueCount: number;
  totalWords: number;
  masteredCount: number;
  masteryPct: number;
  devMode: boolean;
  DevResetButton?: React.ReactNode;
}

export function HomeClient({ dueCount, slangDueCount, totalWords, masteredCount, masteryPct, devMode, DevResetButton }: Props) {
  const { t } = useLanguage();

  const modes = [
    {
      href: "/review",
      label: t.review,
      description: dueCount > 0 ? t.cardsDue(dueCount) : t.allCaughtUp,
      icon: Brain,
      iconBg: "bg-violet-100",
      iconColor: "text-violet-600",
      badge: dueCount > 0 ? dueCount : null,
    },
    {
      href: "/review/slang",
      label: t.slangReview,
      description: slangDueCount > 0 ? t.cardsDue(slangDueCount) : t.allCaughtUp,
      icon: Flame,
      iconBg: "bg-orange-100",
      iconColor: "text-orange-500",
      badge: slangDueCount > 0 ? slangDueCount : null,
    },
    {
      href: "/speaking",
      label: t.speakingPractice,
      description: t.speakingDesc,
      icon: Mic,
      iconBg: "bg-rose-100",
      iconColor: "text-rose-600",
      badge: null,
    },
    {
      href: "/conversation",
      label: t.chatPractice,
      description: t.chatDesc,
      icon: MessageCircle,
      iconBg: "bg-sky-100",
      iconColor: "text-sky-600",
      badge: null,
    },
    {
      href: "/reader",
      label: t.reader,
      description: t.readerDesc,
      icon: BookOpen,
      iconBg: "bg-emerald-100",
      iconColor: "text-emerald-600",
      badge: null,
    },
    {
      href: "/vocab",
      label: t.myVocabulary,
      description: t.vocabDesc,
      icon: List,
      iconBg: "bg-teal-100",
      iconColor: "text-teal-600",
      badge: null,
    },
  ];

  return (
    <main className="min-h-screen bg-[var(--color-background)]">
      <div className="max-w-lg mx-auto px-4 pt-12 pb-10">

        {/* ── Top bar ── */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-600 to-sky-500 bg-clip-text text-transparent">
              {t.appName}
            </h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
              {totalWords > 0 ? t.keepItUp : t.startJourney}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Link
              href="/profile"
              className="relative w-10 h-10 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center hover:border-violet-300 transition-colors shadow-sm"
            >
              <User size={18} className="text-[var(--color-text-secondary)]" />
              {(dueCount + slangDueCount) > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-orange-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                  {dueCount + slangDueCount}
                </span>
              )}
            </Link>
          </div>
        </div>

        {/* ── Progress card ── */}
        <div className="bg-[var(--color-surface)] rounded-2xl p-5 shadow-sm border border-[var(--color-border)] mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <TrendingUp size={20} className="text-blue-500" />
            </div>
            <div>
              <h2 className="font-semibold text-[var(--color-text-primary)]">{t.yourProgress}</h2>
              <p className="text-xs text-[var(--color-text-muted)]">{t.trackJourney}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-4">
            {[
              { value: totalWords, label: t.wordsTracked },
              { value: masteredCount, label: t.mastered },
              { value: `${masteryPct}%`, label: t.mastery },
            ].map((stat) => (
              <div
                key={stat.label}
                className="bg-[var(--color-background)] rounded-xl p-3 text-center"
              >
                <div className="text-xl font-bold text-[var(--color-text-primary)]">
                  {stat.value}
                </div>
                <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5 leading-tight">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)] mb-1.5">
            <span>{t.overallProgress}</span>
            <span className="text-violet-600 font-medium">{masteryPct}%</span>
          </div>
          <div className="h-2 rounded-full bg-[var(--color-background)] overflow-hidden">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-violet-500 to-sky-400 transition-all duration-500"
              style={{ width: `${masteryPct}%` }}
            />
          </div>
        </div>

        {/* ── Learning modes ── */}
        <div>
          <div className="flex items-center gap-1.5 mb-3 px-1">
            <span className="text-base">✨</span>
            <h2 className="font-semibold text-sm text-[var(--color-text-primary)]">{t.learningModes}</h2>
          </div>

          <div className="flex flex-col gap-2">
            {modes.map((mode) => {
              const Icon = mode.icon;
              return (
                <Link
                  key={mode.href}
                  href={mode.href}
                  className="flex items-center gap-3 bg-[var(--color-surface)] rounded-2xl px-4 py-3.5 border border-[var(--color-border)] hover:border-violet-200 hover:shadow-sm transition-all"
                >
                  <div className={`relative w-11 h-11 rounded-xl ${mode.iconBg} flex items-center justify-center flex-shrink-0`}>
                    <Icon size={22} className={mode.iconColor} />
                    {mode.badge !== null && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                        {mode.badge}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-[var(--color-text-primary)]">{mode.label}</div>
                    <div className="text-xs text-[var(--color-text-muted)] mt-0.5">{mode.description}</div>
                  </div>
                  <ChevronRight size={16} className="text-[var(--color-text-muted)] flex-shrink-0" />
                </Link>
              );
            })}
          </div>
        </div>

        {devMode && DevResetButton && (
          <div className="mt-6">{DevResetButton}</div>
        )}
      </div>
    </main>
  );
}
