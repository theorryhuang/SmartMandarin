import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Service-role client — bypasses RLS entirely. Server-only, never import
 * this from a Client Component or anything that ships to the browser.
 *
 * Used where there's no user session cookie to authenticate with (e.g. the
 * browser-extension API routes, which authenticate via a bearer token
 * instead) — every query built from this client MUST manually filter by
 * `user_id` itself, since RLS won't do it.
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");

  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
