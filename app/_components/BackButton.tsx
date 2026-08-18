"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { useLanguage } from "./LanguageContext";

export function BackButton({ href, label }: { href?: string; label?: string }) {
  const router = useRouter();
  const { t } = useLanguage();

  function handleClick() {
    if (href) {
      router.push(href);
    } else {
      router.back();
    }
  }

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
    >
      <ChevronLeft size={18} />
      {label ?? t.back}
    </button>
  );
}
