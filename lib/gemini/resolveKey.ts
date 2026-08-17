import { createClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto/secret";
import { getServerT } from "@/lib/i18n-server";

export type GeminiKeySource = "own" | "owner";

/**
 * Thrown when the caller has no usable Gemini key — routes should surface
 * `.message` as-is, it's already localized (sm_lang cookie) for the end user.
 */
export class NoGeminiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoGeminiKeyError";
  }
}

async function noGeminiKeyError(): Promise<NoGeminiKeyError> {
  const t = await getServerT();
  return new NoGeminiKeyError(t.noGeminiKeyError);
}

/**
 * Picks which Gemini API key a request should bill against. No shared/public
 * fallback — every user pays for their own Gemini usage with their own key:
 *   1. The caller's own BYOK key (app/actions/settings.ts).
 *   2. GEMINI_API_KEY_OWNER, if the caller IS the app owner (OWNER_USER_ID) —
 *      lets the owner skip the settings-page flow for their own account.
 * Anyone else without a saved key gets NoGeminiKeyError.
 *
 * Call from API routes (Node runtime, has access to request cookies via
 * next/headers under the hood through lib/supabase/server's createClient).
 */
export async function resolveGeminiKey(): Promise<{ apiKey: string; source: GeminiKeySource }> {
  const supabase = await createClient();
  // getSession() reads the already-validated session straight from cookies —
  // no network round trip. getUser() would re-verify the JWT against
  // Supabase's Auth server on every single call, which is redundant here:
  // middleware.ts already ran getUser() and refreshed the session for this
  // exact request before this route handler even started (and mirrors the
  // refreshed cookies onto the request, so this sees the same result).
  // That extra round trip was adding real, felt latency to every Gemini call.
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user ?? null;
  if (!user) throw await noGeminiKeyError();

  const { data } = await supabase
    .from("user_settings")
    .select("gemini_api_key_encrypted")
    .eq("user_id", user.id)
    .maybeSingle();

  if (data?.gemini_api_key_encrypted) {
    return { apiKey: decryptSecret(data.gemini_api_key_encrypted), source: "own" };
  }

  if (user.id === process.env.OWNER_USER_ID && process.env.GEMINI_API_KEY_OWNER) {
    return { apiKey: process.env.GEMINI_API_KEY_OWNER, source: "owner" };
  }

  throw await noGeminiKeyError();
}
