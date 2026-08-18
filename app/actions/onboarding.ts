"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getGeminiKeyStatus, getElevenLabsKeyStatus } from "./settings";

export interface OnboardingStatus {
  hasGeminiKey: boolean;
  hasExtensionToken: boolean;
  hasElevenLabsKey: boolean;
}

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return { hasGeminiKey: false, hasExtensionToken: false, hasElevenLabsKey: false };

  const [{ hasKey }, { count }, { hasKey: hasElevenLabsKey }] = await Promise.all([
    getGeminiKeyStatus(),
    supabase.from("extension_tokens").select("id", { count: "exact", head: true }).eq("user_id", userId),
    getElevenLabsKeyStatus(),
  ]);

  return { hasGeminiKey: hasKey, hasExtensionToken: (count ?? 0) > 0, hasElevenLabsKey };
}

/**
 * Sets the sm_onboarded cookie so the home page won't redirect here again —
 * mirrors markAssessmentComplete in app/actions/vocabulary.ts. Call this
 * whether the user actually finished every step or clicked straight through
 * ("Continue to app" doubles as skip); "seen once" is what matters, same as
 * the assessment gate.
 */
export async function markOnboardingComplete(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set("sm_onboarded", "1", {
    path: "/",
    maxAge: 60 * 60 * 24 * 365 * 10, // 10 years
    httpOnly: true,
    sameSite: "lax",
  });
}
