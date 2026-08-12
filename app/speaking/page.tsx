"use client";

import dynamic from "next/dynamic";

// SpeakingClient reads localStorage synchronously (turns, revealed state,
// slang mode) to seed conversation history before the mic hook mounts.
// That output necessarily differs from the server's empty-state HTML, which
// trips React's hydration check. The page has no SEO/SSR value anyway
// (private, client-only voice practice UI), so skip SSR for it entirely
// rather than fighting the mismatch.
const SpeakingClient = dynamic(
  () => import("./SpeakingClient").then((m) => m.SpeakingClient),
  { ssr: false }
);

export default function SpeakingPage() {
  return (
    <main className="h-screen overflow-hidden">
      <SpeakingClient />
    </main>
  );
}
