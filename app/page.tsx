import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { VocabularyMastery } from "@/lib/types";
import { HIGH_STABILITY_THRESHOLD } from "@/lib/fsrs";
import { DevResetButton } from "@/app/_components/DevResetButton";
import { HomeClient, MODE_IDS } from "@/app/_components/HomeClient";

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
        // Same "brand new account" signal the assessment redirect already
        // uses (zero saved words, never assessed) — piggybacked instead of
        // a standalone "just signed up" check so existing users with any
        // history are never retroactively dropped into onboarding. Runs
        // before assessment: /onboarding's own "Continue to app" sets
        // sm_onboarded and sends them back here, where this same branch
        // then falls through to the assessment redirect below.
        const onboarded = cookieStore.get("sm_onboarded");
        redirect(onboarded ? "/assessment" : "/onboarding");
      }
    }
  }

  let dueCount = 0;
  let slangDueCount = 0;
  let totalWords = 0;
  let masteredCount = 0;

  if (userId) {
    const { data } = await supabase
      .from("vocabulary_mastery")
      .select("stability, next_review, flagged_for_immediate_use, is_slang")
      .eq("user_id", userId);

    const words = (data ?? []) as Pick<
      VocabularyMastery,
      "stability" | "next_review" | "flagged_for_immediate_use" | "is_slang"
    >[];

    const isDue = (w: typeof words[0]) =>
      w.flagged_for_immediate_use || !w.next_review || new Date(w.next_review) <= new Date();

    totalWords = words.length;
    masteredCount = words.filter((w) => w.stability >= HIGH_STABILITY_THRESHOLD).length;
    dueCount = words.filter((w) => !w.is_slang && isDue(w)).length;
    slangDueCount = words.filter((w) => w.is_slang && isDue(w)).length;
  }

  const masteryPct = totalWords > 0 ? Math.round((masteredCount / totalWords) * 100) : 0;
  const devMode = process.env.NODE_ENV === "development";

  // Read the saved card order from a cookie (not just localStorage) so the
  // server renders the *already-reordered* layout on first paint — a
  // client-only localStorage read means every load starts at the default
  // order and only snaps to the real one a beat later once an effect fires,
  // which is exactly the "goes back to the order I set, then jumps" flash.
  const orderCookie = (await cookies()).get("sm_mode_order")?.value;
  let initialOrder: string[] | null = null;
  if (orderCookie) {
    try {
      const parsed: string[] = JSON.parse(orderCookie);
      const known = new Set(MODE_IDS);
      if (parsed.length === known.size && parsed.every((id) => known.has(id))) {
        initialOrder = parsed;
      }
    } catch {}
  }

  return (
    <HomeClient
      dueCount={dueCount}
      slangDueCount={slangDueCount}
      totalWords={totalWords}
      masteredCount={masteredCount}
      masteryPct={masteryPct}
      devMode={devMode}
      DevResetButton={devMode ? <DevResetButton /> : undefined}
      initialOrder={initialOrder}
    />
  );
}
