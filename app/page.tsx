import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { HSKLevelStats, DailyStreak } from "@/lib/types";
import { deriveCurrentHSK } from "@/lib/fsrs";
import { DevResetButton } from "@/app/_components/DevResetButton";
import { HomeClient, MODE_IDS } from "@/app/_components/HomeClient";
import { getDailyQuizPendingCount, getDailyStreak } from "@/app/actions/dailyLearning";

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

  // Regular + slang due cards, merged — review is one picker now (Slang is
  // just another tile inside it, see ReviewFilterPicker), not a separate mode.
  let dueCount = 0;
  let hasAnyWords = false;
  let currentHSK: number | null = null;
  let currentLevelMasteryPct = 0;
  let dailyQuizDueCount = 0;
  let streak: DailyStreak = { current: 0, longest: 0, activeDates: [] };

  if (userId) {
    // Both queries below are count-exact / RPC-aggregate — deliberately NOT
    // an unbounded `.select("*")` fetched into memory and counted in JS.
    // PostgREST caps unbounded selects at 1000 rows by default, so an
    // account with 1000+ words (this one included) would silently have its
    // stats computed off a truncated slice. `count: "exact", head: true`
    // and the get_hsk_level_stats() RPC both run as real SQL aggregates
    // server-side and aren't subject to that row-return cap.
    const nowIso = new Date().toISOString();
    const [{ count: due }, { data: hskStats }, { data: settingsRow }] = await Promise.all([
      supabase
        .from("vocabulary_mastery")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .or(`flagged_for_immediate_use.eq.true,next_review.is.null,next_review.lte.${nowIso}`),
      supabase.rpc("get_hsk_level_stats"),
      supabase.from("user_settings").select("assessment_hsk_level").eq("user_id", userId).maybeSingle(),
    ]);
    const assessmentBaseline = settingsRow?.assessment_hsk_level ?? null;

    dueCount = due ?? 0;

    const stats = (hskStats ?? []) as unknown as HSKLevelStats[];
    hasAnyWords = stats.some((s) => s.total > 0);

    // See lib/fsrs.ts's deriveCurrentHSK() — one shared derivation (also
    // used by getConversationContext for the AI) instead of the home page
    // and the AI context each computing their own different answer.
    const derived = deriveCurrentHSK(stats, assessmentBaseline);
    currentHSK = derived?.level ?? null;
    currentLevelMasteryPct = derived ? Math.round(derived.fraction * 100) : 0;

    dailyQuizDueCount = await getDailyQuizPendingCount();
    streak = await getDailyStreak();
  }
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
      dailyQuizDueCount={dailyQuizDueCount}
      streak={streak}
      hasAnyWords={hasAnyWords}
      currentHSK={currentHSK}
      currentLevelMasteryPct={currentLevelMasteryPct}
      devMode={devMode}
      DevResetButton={devMode ? <DevResetButton /> : undefined}
      initialOrder={initialOrder}
    />
  );
}
