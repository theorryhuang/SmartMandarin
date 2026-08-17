"use client";

import dynamic from "next/dynamic";
import type { MasteryMap } from "@/lib/types";

// SpeakingClient reads localStorage synchronously (turns, revealed state,
// slang mode) to seed conversation history before the mic hook mounts.
// That output necessarily differs from the server's empty-state HTML, which
// trips React's hydration check. The page has no SEO/SSR value anyway
// (private, client-only voice practice UI), so skip SSR for it entirely
// rather than fighting the mismatch. `dynamic(..., { ssr: false })` can't
// be called directly inside a Server Component, hence this thin client
// wrapper — page.tsx does the actual masteryMap fetch and hands it down.
const SpeakingClient = dynamic(
  () => import("./SpeakingClient").then((m) => m.SpeakingClient),
  { ssr: false }
);

export function SpeakingClientLoader({ masteryMap }: { masteryMap: MasteryMap }) {
  return <SpeakingClient masteryMap={masteryMap} />;
}
