"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function resetMyData() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Only available in development");
  }

  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) throw new Error("Not authenticated");

  // Delete review_log first (FK references vocabulary_mastery)
  await supabase.from("review_log").delete().eq("user_id", userId);
  await supabase.from("vocabulary_mastery").delete().eq("user_id", userId);

  const cookieStore = await cookies();
  cookieStore.delete("sm_assessed");
  cookieStore.delete("sm_onboarded");

  redirect("/");
}

/**
 * Manually runs the same cleanup the nightly pg_cron job
 * (supabase/migrations/017_stale_conversation_cleanup.sql) does, for
 * verifying it works without waiting for 03:00 UTC.
 *
 * Uses the service-role client, not the normal session client — as of
 * 019_fix_security_definer_idor.sql, delete_stale_conversations() is no
 * longer callable by the `authenticated` role at all (it's unscoped by
 * design, so any signed-in user calling it directly could nuke everyone's
 * conversations on demand). Only pg_cron and service-role can run it now.
 */
export async function runStaleConversationCleanup(): Promise<void> {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Only available in development");
  }
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)("delete_stale_conversations");
  if (error) throw new Error(error.message);
}
