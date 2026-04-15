"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/app/_components/LanguageContext";

export function SignOutButton() {
  const router = useRouter();
  const { t } = useLanguage();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth");
  }

  return (
    <button
      onClick={handleSignOut}
      className="w-full py-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-raised)] text-sm font-medium transition-all text-red-400 hover:text-red-300"
    >
      {t.signOut}
    </button>
  );
}
