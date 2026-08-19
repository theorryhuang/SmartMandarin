"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Permanently deletes the current user's account and everything attached to
 * it. Every user-owned table (vocabulary_mastery, review_log, chat_messages,
 * extension_tokens, user_settings/gemini keys) declares
 * `references auth.users(id) on delete cascade`, so deleting the auth user
 * cascades through all of it in one step — no manual per-table cleanup.
 *
 * Requires the service-role client: deleting an auth user (even your own)
 * is an admin-only operation — the regular cookie-authed client can't do
 * this for itself, only sign itself out.
 */
export async function deleteAccount(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const admin = createServiceClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return { ok: false, error: error.message };

  // sm_assessed/sm_onboarded live on the browser, not the account — without
  // this, signing up again in the same browser after deleting an account
  // looks "already onboarded" (cookie still says so) despite having zero
  // data, and silently skips both the onboarding checklist and the
  // assessment quiz.
  const cookieStore = await cookies();
  cookieStore.delete("sm_assessed");
  cookieStore.delete("sm_onboarded");

  return { ok: true };
}
