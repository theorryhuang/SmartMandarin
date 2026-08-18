"use server";

import { createClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto/secret";
import { getServerT } from "@/lib/i18n-server";

export interface GeminiKeyStatus {
  hasKey: boolean;
  last4: string | null;
}

export async function getGeminiKeyStatus(): Promise<GeminiKeyStatus> {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return { hasKey: false, last4: null };

  const { data } = await supabase
    .from("user_settings")
    .select("gemini_api_key_last4")
    .eq("user_id", userId)
    .maybeSingle();

  return { hasKey: !!data?.gemini_api_key_last4, last4: data?.gemini_api_key_last4 ?? null };
}

/**
 * Saves a BYOK Gemini key for the current user. Validates the key actually
 * works (a real call, not just a format check) before persisting it, so a
 * typo doesn't quietly break every Gemini-backed feature for that user.
 */
export async function saveGeminiKey(
  rawKey: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const t = await getServerT();
  const key = rawKey.trim();
  if (!key) return { ok: false, error: t.geminiKeyErrorEmpty };
  if (key.length < 20) return { ok: false, error: t.geminiKeyErrorTooShort };

  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return { ok: false, error: t.geminiKeyErrorNotSignedIn };

  // Verify the key actually works before storing it — a cheap, read-only call.
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
      headers: { "x-goog-api-key": key },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const msg = body.includes("API_KEY_INVALID") || res.status === 400 || res.status === 403
        ? t.geminiKeyErrorRejected
        : t.geminiKeyErrorApi(res.status);
      return { ok: false, error: msg };
    }
  } catch {
    return { ok: false, error: t.geminiKeyErrorUnreachable };
  }

  // encryptSecret() throws synchronously (e.g. SETTINGS_ENCRYPTION_KEY unset
  // or malformed) — left unguarded before, that took down the whole server
  // action with an unhandled exception instead of a normal { ok: false }
  // reply, which left the client's "Verifying…" button spinning forever
  // (nothing ever ran to flip it back off).
  try {
    const { error } = await supabase.from("user_settings").upsert(
      {
        user_id: userId,
        gemini_api_key_encrypted: encryptSecret(key),
        gemini_api_key_last4: key.slice(-4),
      },
      { onConflict: "user_id" }
    );
    if (error) return { ok: false, error: error.message };
  } catch (e) {
    console.error("[saveGeminiKey] failed to store key:", e);
    return { ok: false, error: t.geminiKeyErrorSaveFailed };
  }

  return { ok: true };
}

export async function removeGeminiKey(): Promise<void> {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return;

  await supabase
    .from("user_settings")
    .update({ gemini_api_key_encrypted: null, gemini_api_key_last4: null })
    .eq("user_id", userId);
}

// ── ElevenLabs key (BYOK, with a shared-key fallback — see lib/elevenlabs/resolveKey.ts) ──

export interface ElevenLabsKeyStatus {
  hasKey: boolean;
  last4: string | null;
}

export async function getElevenLabsKeyStatus(): Promise<ElevenLabsKeyStatus> {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return { hasKey: false, last4: null };

  const { data } = await supabase
    .from("user_settings")
    .select("elevenlabs_api_key_last4")
    .eq("user_id", userId)
    .maybeSingle();

  return { hasKey: !!data?.elevenlabs_api_key_last4, last4: data?.elevenlabs_api_key_last4 ?? null };
}

/**
 * Saves a BYOK ElevenLabs key for the current user. Validates the key
 * actually works (a real call, not just a format check) before persisting
 * it, mirroring saveGeminiKey.
 */
export async function saveElevenLabsKey(
  rawKey: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const t = await getServerT();
  const key = rawKey.trim();
  if (!key) return { ok: false, error: t.elevenLabsKeyErrorEmpty };
  if (key.length < 20) return { ok: false, error: t.elevenLabsKeyErrorTooShort };

  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return { ok: false, error: t.elevenLabsKeyErrorNotSignedIn };

  // Verify the key actually works before storing it — a cheap, read-only
  // call against /v1/user. That endpoint needs the "User" permission,
  // though, which a key correctly restricted to just Speech to Text (as
  // this same settings page tells users to do — see the permissions hint
  // in ElevenLabsKeySettingsClient) never has. A 401/403 there is
  // ambiguous on its own: "this key doesn't exist" and "this key exists
  // but isn't allowed to read /user" look identical from the status code
  // alone. ElevenLabs' error body says which one it actually is (a bad key
  // reports "invalid_api_key"; a real key missing a scope reports
  // something permission-flavored) — only reject on the former.
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/user", {
      headers: { "xi-api-key": key },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const detail = JSON.stringify(body?.detail ?? "").toLowerCase();
      const scopedButValid = (res.status === 401 || res.status === 403) && detail.includes("permission");
      if (!scopedButValid) {
        const msg = res.status === 401 || res.status === 403
          ? t.elevenLabsKeyErrorRejected
          : t.elevenLabsKeyErrorApi(res.status);
        return { ok: false, error: msg };
      }
    }
  } catch {
    return { ok: false, error: t.elevenLabsKeyErrorUnreachable };
  }

  try {
    const { error } = await supabase.from("user_settings").upsert(
      {
        user_id: userId,
        elevenlabs_api_key_encrypted: encryptSecret(key),
        elevenlabs_api_key_last4: key.slice(-4),
      },
      { onConflict: "user_id" }
    );
    if (error) return { ok: false, error: error.message };
  } catch (e) {
    console.error("[saveElevenLabsKey] failed to store key:", e);
    return { ok: false, error: t.elevenLabsKeyErrorSaveFailed };
  }

  return { ok: true };
}

export async function removeElevenLabsKey(): Promise<void> {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return;

  await supabase
    .from("user_settings")
    .update({ elevenlabs_api_key_encrypted: null, elevenlabs_api_key_last4: null })
    .eq("user_id", userId);
}
