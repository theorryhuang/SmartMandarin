"use client";

import { useState } from "react";
import { Check, Loader2, Trash2, ExternalLink } from "lucide-react";
import { saveElevenLabsKey, removeElevenLabsKey, type ElevenLabsKeyStatus } from "@/app/actions/settings";
import { useLanguage } from "@/app/_components/LanguageContext";

export function ElevenLabsKeySettingsClient({ initialStatus }: { initialStatus: ElevenLabsKeyStatus }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState(initialStatus);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!input.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const result = await saveElevenLabsKey(input.trim());
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setInput("");
      setStatus({ hasKey: true, last4: input.trim().slice(-4) });
    } catch {
      setError(t.elevenLabsKeyErrorSaveFailed);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setRemoving(true);
    await removeElevenLabsKey().catch(() => {});
    setStatus({ hasKey: false, last4: null });
    setRemoving(false);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Get a key */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col gap-2 text-sm text-[var(--color-text-secondary)]">
        <div className="font-medium text-[var(--color-text-primary)]">{t.elevenLabsKeyGetTitle}</div>
        <p>{t.elevenLabsKeyGetDesc}</p>
        <a
          href="https://elevenlabs.io/app/settings/api-keys"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-violet-600 hover:text-violet-700 font-medium w-fit"
        >
          elevenlabs.io/app/settings/api-keys <ExternalLink size={13} />
        </a>

        {/* This app only ever calls /v1/speech-to-text (see
            app/api/transcribe/route.ts) — scoping the key down to just that
            permission means a leaked key can't be used to burn TTS credits,
            pull your voice library, etc. */}
        <div className="rounded-xl bg-[var(--color-background)] border border-[var(--color-border)] px-3 py-2.5 text-xs text-[var(--color-text-secondary)] mt-1">
          {t.elevenLabsKeyPermissionsHint}
        </div>
      </div>

      {/* Current status — unlike Gemini, no key isn't a dead end: the app
          falls back to a shared key, so this is informational, not a warning. */}
      {status.hasKey ? (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-emerald-800">
            <Check size={16} />
            <span>{t.elevenLabsKeyUsingOwn(status.last4 ?? "")}</span>
          </div>
          <button
            onClick={handleRemove}
            disabled={removing}
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-red-500 hover:bg-red-100 transition-colors disabled:opacity-50"
            title={t.elevenLabsKeyRemoveTitle}
          >
            {removing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-text-secondary)]">
          {t.elevenLabsKeyNoneSaved}
        </div>
      )}

      {/* Add / replace */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-[var(--color-text-muted)]">
          {status.hasKey ? t.elevenLabsKeyReplace : t.elevenLabsKeyAddYours}
        </span>
        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t.elevenLabsKeyPlaceholder}
          className="w-full px-3 py-2.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-violet-400 transition-colors"
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          onClick={handleSave}
          disabled={saving || !input.trim()}
          className="w-full py-3 rounded-2xl bg-violet-700 hover:bg-violet-600 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {saving ? t.elevenLabsKeyVerifying : t.elevenLabsKeySave}
        </button>
      </div>
    </div>
  );
}
