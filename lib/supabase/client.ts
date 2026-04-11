import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

/**
 * Use in Client Components ("use client").
 * Reads NEXT_PUBLIC_* vars that are safe to expose in the browser.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
