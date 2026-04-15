"use client";

import { useLanguage } from "./LanguageContext";

export function LanguageSwitcher() {
  const { lang, setLang } = useLanguage();

  return (
    <div className="flex items-center gap-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5 shadow-sm">
      <button
        onClick={() => setLang("en")}
        className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
          lang === "en"
            ? "bg-violet-600 text-white"
            : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
        }`}
      >
        EN
      </button>
      <button
        onClick={() => setLang("zh")}
        className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
          lang === "zh"
            ? "bg-violet-600 text-white"
            : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
        }`}
      >
        中
      </button>
    </div>
  );
}
