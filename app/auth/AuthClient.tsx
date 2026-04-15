"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/app/_components/LanguageContext";

type PhasePhone = "idle" | "sending" | "otp" | "verifying" | "done";

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

  // ── Phone OTP ────────────────────────────────────────────────────────────────

  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [phonePhase, setPhonePhase] = useState<PhasePhone>("idle");
  const [phoneError, setPhoneError] = useState("");

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    setPhoneError("");
    setPhonePhase("sending");

    const { error } = await supabase.auth.signInWithOtp({
      phone,
      options: { channel: "sms" },
    });

    if (error) {
      setPhoneError(error.message);
      setPhonePhase("idle");
    } else {
      setPhonePhase("otp");
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setPhoneError("");
    setPhonePhase("verifying");

    const { error } = await supabase.auth.verifyOtp({
      phone,
      token: otp,
      type: "sms",
    });

    if (error) {
      setPhoneError(error.message);
      setPhonePhase("otp");
    } else {
      setPhonePhase("done");
      // Supabase sets the session cookie; the middleware will then let the
      // user through on the next navigation.
      window.location.href = "/";
    }
  }

  function resetPhone() {
    setPhonePhase("idle");
    setOtp("");
    setPhoneError("");
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6">
      <div className="w-full max-w-sm flex flex-col gap-8">

        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight mb-2">{t.appName}</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            {t.signInToSave}
          </p>
        </div>

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

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-[var(--color-border)]" />
          <span className="text-xs text-[var(--color-text-muted)]">{t.or}</span>
          <div className="flex-1 h-px bg-[var(--color-border)]" />
        </div>

        {/* ── Phone OTP ── */}
        <div className="flex flex-col gap-3">
          {phonePhase === "idle" || phonePhase === "sending" ? (
            <form onSubmit={sendOtp} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[var(--color-text-muted)]" htmlFor="phone">
                  {t.phoneNumber}
                </label>
                <input
                  id="phone"
                  type="tel"
                  placeholder={t.phonePlaceholder}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] text-sm placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-violet-600 transition-colors"
                />
                <p className="text-[10px] text-[var(--color-text-muted)] pl-1">
                  {t.phoneHint}
                </p>
              </div>
              <button
                type="submit"
                disabled={phonePhase === "sending" || !phone.trim()}
                className="w-full py-3 rounded-2xl bg-violet-700 hover:bg-violet-600 text-white text-sm font-medium transition-all disabled:opacity-50"
              >
                {phonePhase === "sending" ? t.sendingCode : t.sendCode}
              </button>
            </form>
          ) : phonePhase === "otp" || phonePhase === "verifying" ? (
            <form onSubmit={verifyOtp} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[var(--color-text-muted)]" htmlFor="otp">
                  {t.verificationCode}
                </label>
                <p className="text-xs text-[var(--color-text-secondary)] mb-1">
                  {t.sentTo(phone)}
                </p>
                <input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  placeholder="000000"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  required
                  autoFocus
                  className="w-full px-4 py-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] text-sm tracking-widest placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-violet-600 transition-colors"
                />
              </div>
              <button
                type="submit"
                disabled={phonePhase === "verifying" || otp.length < 6}
                className="w-full py-3 rounded-2xl bg-violet-700 hover:bg-violet-600 text-white text-sm font-medium transition-all disabled:opacity-50"
              >
                {phonePhase === "verifying" ? t.verifying : t.verifyCode}
              </button>
              <button
                type="button"
                onClick={resetPhone}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] text-center transition-colors"
              >
                {t.useDifferentNumber}
              </button>
            </form>
          ) : null /* done — redirecting */}

          {phoneError && (
            <p className="text-xs text-red-400 text-center">{phoneError}</p>
          )}
        </div>

      </div>
    </div>
  );
}
