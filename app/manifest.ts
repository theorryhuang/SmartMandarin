import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SmartMandarin",
    short_name: "SmartMandarin",
    description: "Adaptive Mandarin learning powered by FSRS and Gemini Live",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
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
