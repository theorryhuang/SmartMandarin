import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { VocabularyMastery } from "@/lib/types";
import { HIGH_STABILITY_THRESHOLD } from "@/lib/fsrs";

export default async function Home() {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id;

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

  const nav = [
    {
      href: "/review",
      label: "Review",
      description: dueCount > 0 ? `${dueCount} cards due` : "All caught up",
      badge: dueCount > 0 ? dueCount : null,
      accent: "violet",
    },
    {
      href: "/conversation",
      label: "Conversation",
      description: "Practice speaking with Gemini Live",
      badge: null,
      accent: "emerald",
    },
    {
      href: "/reader",
      label: "Reader",
      description: "Read stories at your level",
      badge: null,
      accent: "blue",
    },
  ];

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 gap-10">
      <div className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight">SmartMandarin</h1>
        {totalWords > 0 && (
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            {totalWords} words tracked · {masteredCount} mastered
          </p>
        )}
      </div>

      <div className="w-full max-w-sm flex flex-col gap-3">
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group flex items-center justify-between rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4 hover:border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-raised)] transition-all"
          >
            <div>
              <div className="font-medium text-[var(--color-text-primary)]">{item.label}</div>
              <div className="text-xs text-[var(--color-text-muted)] mt-0.5">{item.description}</div>
            </div>
            {item.badge !== null && (
              <span className="ml-3 flex h-6 w-6 items-center justify-center rounded-full bg-violet-700 text-xs font-medium text-white flex-shrink-0">
                {item.badge}
              </span>
            )}
          </Link>
        ))}
      </div>
    </main>
  );
}
