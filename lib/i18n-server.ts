import { cookies } from "next/headers";
import { translations, type Lang } from "@/lib/i18n";

/**
 * Same sm_lang cookie RootLayout reads to pick the initial language
 * server-side (see app/layout.tsx) — lets server actions and API routes
 * return already-localized text without a client round-trip, for errors
 * that need to surface before/without the LanguageContext being available
 * (e.g. thrown from a Node-runtime API route).
 */
export async function getServerLang(): Promise<Lang> {
  const cookieStore = await cookies();
  return cookieStore.get("sm_lang")?.value === "zh" ? "zh" : "en";
}

export async function getServerT(): Promise<typeof translations["en"]> {
  return translations[await getServerLang()];
}
