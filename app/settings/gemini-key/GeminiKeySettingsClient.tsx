"use client";

import { useState } from "react";
import { Check, Loader2, Trash2, ExternalLink } from "lucide-react";
import { saveGeminiKey, removeGeminiKey, type GeminiKeyStatus } from "@/app/actions/settings";
import { useLanguage } from "@/app/_components/LanguageContext";

export function GeminiKeySettingsClient({ initialStatus }: { initialStatus: GeminiKeyStatus }) {
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
    const result = await saveGeminiKey(input.trim());
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setInput("");
    setStatus({ hasKey: true, last4: input.trim().slice(-4) });
  }

  async function handleRemove() {
    setRemoving(true);
    await removeGeminiKey().catch(() => {});
    setStatus({ hasKey: false, last4: null });
    setRemoving(false);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Get a key */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col gap-2 text-sm text-[var(--color-text-secondary)]">
        <div className="font-medium text-[var(--color-text-primary)]">{t.geminiKeyGetFreeTitle}</div>
        <p>{t.geminiKeyGetFreeDesc}</p>
        <a
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-violet-600 hover:text-violet-700 font-medium w-fit"
        >
          aistudio.google.com/apikey <ExternalLink size={13} />
        </a>
      </div>

      {/* Current status */}
      {status.hasKey ? (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-emerald-800">
            <Check size={16} />
            <span>{t.geminiKeyUsingOwn(status.last4 ?? "")}</span>
          </div>
          <button
            onClick={handleRemove}
            disabled={removing}
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-red-500 hover:bg-red-100 transition-colors disabled:opacity-50"
            title={t.geminiKeyRemoveTitle}
          >
            {removing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          {t.geminiKeyNoneSaved}
        </div>
      )}

      {/* Add / replace */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-[var(--color-text-muted)]">
          {status.hasKey ? t.geminiKeyReplace : t.geminiKeyAddYours}
        </span>
        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t.geminiKeyPlaceholder}
          className="w-full px-3 py-2.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-violet-400 transition-colors"
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          onClick={handleSave}
          disabled={saving || !input.trim()}
          className="w-full py-3 rounded-2xl bg-violet-700 hover:bg-violet-600 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {saving ? t.geminiKeyVerifying : t.geminiKeySave}
        </button>
      </div>
    </div>
  );
}
