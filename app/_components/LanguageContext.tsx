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

const COOKIE_NAME = "sm_lang";

function setLangCookie(lang: Lang) {
  // A cookie, not localStorage — this is what lets the root layout read the
  // right language *server-side* on the very next request, so the page
  // renders correctly on first paint instead of always starting at "en" and
  // snapping to the real value a beat later once a client effect runs
  // (that snap is exactly what "goes back to the wrong language for a
  // second" was — see RootLayout).
  document.cookie = `${COOKIE_NAME}=${lang}; path=/; max-age=31536000; SameSite=Lax`;
}

export function LanguageProvider({
  children,
  initialLang,
}: {
  children: ReactNode;
  /** Read server-side from the sm_lang cookie in RootLayout — the initial
   *  render is already correct, no flash-then-correct needed. */
  initialLang: Lang;
}) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  // One-time migration for anyone who set their language before this moved
  // from localStorage to a cookie — without this, everyone who'd picked
  // "zh" would silently land back on "en" the first time they load the app
  // post-upgrade, since the server has never heard of their localStorage
  // value. Only ever does anything on that first post-upgrade load; once
  // the cookie exists, `saved === initialLang` and this no-ops forever after.
  useEffect(() => {
    const saved = localStorage.getItem("sm_lang");
    if ((saved === "en" || saved === "zh") && saved !== initialLang) {
      setLangState(saved);
      setLangCookie(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setLang(next: Lang) {
    setLangState(next);
    setLangCookie(next);
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
