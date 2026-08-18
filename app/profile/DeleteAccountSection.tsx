"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/app/_components/LanguageContext";
import { deleteAccount } from "@/app/actions/account";

const CONFIRM_WORD = "DELETE";

export function DeleteAccountSection() {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  function reset() {
    setOpen(false);
    setConfirmText("");
    setError("");
  }

  async function handleDelete() {
    setDeleting(true);
    setError("");
    const result = await deleteAccount();
    if (!result.ok) {
      setError(result.error || t.deleteAccountFailed);
      setDeleting(false);
      return;
    }
    // The account is already gone server-side at this point — this just
    // clears the now-orphaned session cookie/local storage on this device.
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth");
  }

  return (
    <div className="w-full flex flex-col gap-3 pt-4 mt-2 border-t border-[var(--color-border)]">
      <span className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
        {t.dangerZone}
      </span>

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="w-full py-3 rounded-2xl border border-red-200 text-red-500 hover:bg-red-50 text-sm font-medium transition-colors"
        >
          {t.deleteAccountBtn}
        </button>
      ) : (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 flex flex-col gap-3">
          <div className="flex items-start gap-2">
            <TriangleAlert size={16} className="text-red-500 shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">{t.deleteAccountWarning}</p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-red-700">{t.deleteAccountConfirmPrompt}</label>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={CONFIRM_WORD}
              autoComplete="off"
              className="w-full px-3 py-2 rounded-xl border border-red-200 bg-white text-sm focus:outline-none focus:border-red-500"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={reset}
              disabled={deleting}
              className="flex-1 py-2.5 rounded-xl border border-[var(--color-border)] bg-white text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-background)] transition-colors disabled:opacity-50"
            >
              {t.cancel}
            </button>
            <button
              onClick={handleDelete}
              disabled={confirmText !== CONFIRM_WORD || deleting}
              className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {deleting && <Loader2 size={14} className="animate-spin" />}
              {deleting ? t.deleteAccountDeleting : t.deleteAccountConfirmBtn}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
