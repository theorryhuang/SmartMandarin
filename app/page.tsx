import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Brain, MessageCircle, BookOpen, TrendingUp, ChevronRight, User, Mic } from "lucide-react";
import type { VocabularyMastery } from "@/lib/types";
import { HIGH_STABILITY_THRESHOLD } from "@/lib/fsrs";
import { DevResetButton } from "@/app/_components/DevResetButton";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id;

  if (userId) {
    const cookieStore = await cookies();
    const assessed = cookieStore.get("sm_assessed");
    if (!assessed) {
      const { count } = await supabase
        .from("vocabulary_mastery")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);
      if ((count ?? 0) === 0) {
        redirect("/assessment");
      }
    }
  }

  let dueCount = 0;
  let totalWords = 0;
  let masteredCount = 0;

  if (userId) {
    const { data } = await supabase
      .from("vocabulary_mastery")
      .select("stability, next_review, flagged_for_immediate_use")
      .eq("user_id", userId);

    const words = (data ?? []) as Pick<
      VocabularyMastery,
      "stability" | "next_review" | "flagged_for_immediate_use"
    >[];

    totalWords = words.length;
    masteredCount = words.filter((w) => w.stability >= HIGH_STABILITY_THRESHOLD).length;
    dueCount = words.filter(
      (w) =>
        w.flagged_for_immediate_use ||
        !w.next_review ||
        new Date(w.next_review) <= new Date()
    ).length;
  }

  const masteryPct = totalWords > 0 ? Math.round((masteredCount / totalWords) * 100) : 0;

  const modes = [
    {
      href: "/review",
      label: "Review",
      description: dueCount > 0 ? `${dueCount} card${dueCount !== 1 ? "s" : ""} due` : "All caught up",
      icon: Brain,
      iconBg: "bg-violet-100",
      iconColor: "text-violet-600",
      badge: dueCount > 0 ? dueCount : null,
    },
    {
      href: "/speaking",
      label: "Speaking Practice",
      description: "Hold to speak · AI responds in Mandarin",
      icon: Mic,
      iconBg: "bg-rose-100",
      iconColor: "text-rose-600",
      badge: null,
    },
    {
      href: "/conversation",
      label: "Chat Practice",
      description: "Practice Mandarin · Tap words to save",
      icon: MessageCircle,
      iconBg: "bg-sky-100",
      iconColor: "text-sky-600",
      badge: null,
    },
    {
      href: "/reader",
      label: "Reader",
      description: "Read stories at your level",
      icon: BookOpen,
      iconBg: "bg-emerald-100",
      iconColor: "text-emerald-600",
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
              SmartMandarin
            </h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
              {totalWords > 0 ? "Keep up the great work!" : "Start your learning journey"}
            </p>
          </div>
          <Link
            href="/profile"
            className="relative w-10 h-10 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center hover:border-violet-300 transition-colors shadow-sm"
          >
            <User size={18} className="text-[var(--color-text-secondary)]" />
            {dueCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-orange-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                {dueCount}
              </span>
            )}
          </Link>
        </div>

        {/* ── Progress card ── */}
        <div className="bg-[var(--color-surface)] rounded-2xl p-5 shadow-sm border border-[var(--color-border)] mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <TrendingUp size={20} className="text-blue-500" />
            </div>
            <div>
              <h2 className="font-semibold text-[var(--color-text-primary)]">Your Progress</h2>
              <p className="text-xs text-[var(--color-text-muted)]">Track your learning journey</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-4">
            {[
              { value: totalWords, label: "Words Tracked" },
              { value: masteredCount, label: "Mastered" },
              { value: `${masteryPct}%`, label: "Mastery" },
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
            <span>Overall Progress</span>
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
            <h2 className="font-semibold text-sm text-[var(--color-text-primary)]">Learning Modes</h2>
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

        {process.env.NODE_ENV === "development" && (
          <div className="mt-6">
            <DevResetButton />
          </div>
        )}
      </div>
    </main>
  );
}
