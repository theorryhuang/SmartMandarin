import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { VocabularyMastery } from "@/lib/types";
import { HIGH_STABILITY_THRESHOLD } from "@/lib/fsrs";
import { DevResetButton } from "@/app/_components/DevResetButton";
import { HomeClient } from "@/app/_components/HomeClient";

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
  const devMode = process.env.NODE_ENV === "development";

  return (
    <HomeClient
      dueCount={dueCount}
      totalWords={totalWords}
      masteredCount={masteredCount}
      masteryPct={masteryPct}
      devMode={devMode}
      DevResetButton={devMode ? <DevResetButton /> : undefined}
    />
  );
}
