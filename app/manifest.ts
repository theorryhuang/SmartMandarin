import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SmartMandarin",
    short_name: "SmartMandarin",
    description: "Adaptive Mandarin learning powered by FSRS and Gemini Live",
    start_url: "/",
    display: "standalone",
    // background_color matches the new icon's rice-paper cream so the
    // launch splash doesn't flash dark-then-cream before content paints.
    // theme_color stays the app's actual dark UI color — that hasn't
    // changed, only the icon artwork has.
    background_color: "#faf7f2",
    theme_color: "#0a0a0a",
    // Desktop Chrome/Edge only: asks installed-app links (e.g. a word URL
    // opened from outside the app) to navigate the existing app window
    // instead of opening a browser tab. Not in Next's Manifest type yet, so
    // it's spread in untyped below. No iOS equivalent — Apple gates that
    // (Universal Links) behind a paid Developer Program account.
    // @ts-expect-error -- capture_links isn't in Next's MetadataRoute.Manifest type yet
    capture_links: "existing-client-navigate",
    icons: [
      // Next's manifest type only allows one purpose per entry (the actual
      // web-manifest spec permits a space-separated list) — list "any" and
      // "maskable" separately per size, both pointing at the same asset,
      // since it already carries the safe-zone padding "maskable" needs.
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
