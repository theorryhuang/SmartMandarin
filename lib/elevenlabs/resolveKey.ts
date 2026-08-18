import { createClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto/secret";
import { getServerT } from "@/lib/i18n-server";

export type ElevenLabsKeySource = "own" | "owner";

/**
 * Thrown when the caller has no usable ElevenLabs key — routes should
 * surface `.message` as-is, it's already localized (sm_lang cookie).
 */
export class NoElevenLabsKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoElevenLabsKeyError";
  }
}

/**
 * Picks which ElevenLabs API key a transcription request should bill
 * against. No shared/public fallback — mirrors resolveGeminiKey exactly, on
 * purpose: a shared key here meant every Speaking Practice recording ate
 * into one project-wide quota regardless of who made it, which is exactly
 * what BYOK avoids.
 *   1. The caller's own BYOK key (app/actions/settings.ts).
 *   2. ELEVENLABS_API_KEY, if the caller IS the app owner (OWNER_USER_ID) —
 *      lets the owner skip the settings-page flow for their own account,
 *      same as GEMINI_API_KEY_OWNER.
 * Anyone else without a saved key gets NoElevenLabsKeyError.
 */
export async function resolveElevenLabsKey(): Promise<{ apiKey: string; source: ElevenLabsKeySource }> {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user ?? null;
  if (!user) throw await noElevenLabsKeyError();

  const { data } = await supabase
    .from("user_settings")
    .select("elevenlabs_api_key_encrypted")
    .eq("user_id", user.id)
    .maybeSingle();

  if (data?.elevenlabs_api_key_encrypted) {
    return { apiKey: decryptSecret(data.elevenlabs_api_key_encrypted), source: "own" };
  }

  if (user.id === process.env.OWNER_USER_ID && process.env.ELEVENLABS_API_KEY) {
    return { apiKey: process.env.ELEVENLABS_API_KEY, source: "owner" };
  }

  throw await noElevenLabsKeyError();
}

async function noElevenLabsKeyError(): Promise<NoElevenLabsKeyError> {
  const t = await getServerT();
  return new NoElevenLabsKeyError(t.noElevenLabsKeyError);
}
