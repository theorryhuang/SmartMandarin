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

  const { error } = await supabase.from("user_settings").upsert(
    {
      user_id: userId,
      gemini_api_key_encrypted: encryptSecret(key),
      gemini_api_key_last4: key.slice(-4),
    },
    { onConflict: "user_id" }
  );
  if (error) return { ok: false, error: error.message };

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
