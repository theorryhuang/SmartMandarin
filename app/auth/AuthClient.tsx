"use client";

import { useState } from "react";
import { Brain, Sparkles, Mic, MessageCircle, BookOpen, List, type LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/app/_components/LanguageContext";
import { LanguageSwitcher } from "@/app/_components/LanguageSwitcher";

// Same six modes/icons as the home screen (app/_components/HomeClient.tsx) —
// signed-out visitors get a preview of what they're signing up for, using
// the same marketing-style copy as the Instructions page's tab breakdown.
const FEATURES: { icon: LucideIcon; iconBg: string; iconColor: string; titleKey: "instructionsTabReviewTitle" | "instructionsTabDailyTitle" | "instructionsTabSpeakingTitle" | "instructionsTabConversationTitle" | "instructionsTabReaderTitle" | "instructionsTabVocabTitle"; descKey: "instructionsTabReviewDesc" | "instructionsTabDailyDesc" | "instructionsTabSpeakingDesc" | "instructionsTabConversationDesc" | "instructionsTabReaderDesc" | "instructionsTabVocabDesc" }[] = [
  { icon: Brain,         iconBg: "bg-violet-100",  iconColor: "text-violet-600",  titleKey: "instructionsTabReviewTitle",       descKey: "instructionsTabReviewDesc" },
  { icon: Sparkles,      iconBg: "bg-amber-100",   iconColor: "text-amber-600",   titleKey: "instructionsTabDailyTitle",        descKey: "instructionsTabDailyDesc" },
  { icon: Mic,           iconBg: "bg-rose-100",    iconColor: "text-rose-600",    titleKey: "instructionsTabSpeakingTitle",     descKey: "instructionsTabSpeakingDesc" },
  { icon: MessageCircle, iconBg: "bg-sky-100",     iconColor: "text-sky-600",     titleKey: "instructionsTabConversationTitle", descKey: "instructionsTabConversationDesc" },
  { icon: BookOpen,      iconBg: "bg-emerald-100", iconColor: "text-emerald-600", titleKey: "instructionsTabReaderTitle",       descKey: "instructionsTabReaderDesc" },
  { icon: List,          iconBg: "bg-teal-100",    iconColor: "text-teal-600",    titleKey: "instructionsTabVocabTitle",        descKey: "instructionsTabVocabDesc" },
];

export function AuthClient({ errorParam }: { errorParam?: string }) {
  const supabase = createClient();
  const { t } = useLanguage();

  // ── Google OAuth ─────────────────────────────────────────────────────────────

  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState("");

  async function signInWithGoogle() {
    setGoogleLoading(true);
    setGoogleError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${location.origin}/auth/callback`,
      },
    });
    if (error) {
      setGoogleError(error.message);
      setGoogleLoading(false);
    }
    // On success, the browser is redirected — no further action needed here.
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col items-center min-h-screen px-6 py-12">
      <div className="absolute right-6" style={{ top: "max(24px, env(safe-area-inset-top))" }}>
        <LanguageSwitcher />
      </div>

      <div className="w-full max-w-sm flex flex-col gap-8 my-auto">

        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight mb-2">{t.appName}</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            {t.appTagline}
          </p>
        </div>

        {/* ── What you get ── — same six modes as the home screen, so
            signed-out visitors see what they're signing up for before the
            Google button. */}
        <div className="grid grid-cols-1 gap-2.5">
          {FEATURES.map(({ icon: Icon, iconBg, iconColor, titleKey, descKey }) => (
            <div
              key={titleKey}
              className="flex items-start gap-3 bg-[var(--color-surface)] rounded-2xl px-4 py-3 border border-[var(--color-border)]"
            >
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconBg} ${iconColor}`}>
                <Icon size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--color-text-primary)]">{t[titleKey]}</div>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{t[descKey]}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="text-sm text-[var(--color-text-muted)] text-center -mt-2">
          {t.signInToSave}
        </p>

        {/* Server-side auth error (e.g. OAuth callback failure) */}
        {errorParam === "auth_failed" && (
          <p className="text-xs text-red-400 text-center -mb-4">
            {t.authFailed}
          </p>
        )}

        {/* ── Google ── */}
        <div className="flex flex-col gap-3">
          <button
            onClick={signInWithGoogle}
            disabled={googleLoading}
            className="w-full flex items-center justify-center gap-3 py-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-raised)] text-sm font-medium transition-all disabled:opacity-50"
          >
            {/* Google "G" logo */}
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
              <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
            </svg>
            {googleLoading ? t.redirecting : t.continueWithGoogle}
          </button>
          {googleError && (
            <p className="text-xs text-red-400 text-center">{googleError}</p>
          )}
        </div>

      </div>
    </div>
  );
}
