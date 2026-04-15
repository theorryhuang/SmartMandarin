"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { translations, type Lang } from "@/lib/i18n";

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: typeof translations.en;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: "en",
  setLang: () => {},
  t: translations.en,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const saved = localStorage.getItem("sm_lang") as Lang | null;
    if (saved === "en" || saved === "zh") {
      setLangState(saved);
    }
  }, []);

  function setLang(next: Lang) {
    setLangState(next);
    localStorage.setItem("sm_lang", next);
  }

  return (
    <LanguageContext.Provider value={{ lang, setLang, t: translations[lang] }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
