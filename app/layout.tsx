import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { LanguageProvider } from "./_components/LanguageContext";

export const metadata: Metadata = {
  title: "SmartMandarin",
  description: "Adaptive Mandarin learning powered by FSRS and Gemini Live",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SmartMandarin",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* iOS home screen icon: app/apple-icon.png (Next's file convention)
          injects the <link rel="apple-touch-icon"> automatically, already
          rounded — unlike /icons/icon-192.png which is full-bleed for the
          Android maskable crop and looks over-padded here. */}
      <body className="min-h-screen bg-[var(--color-background)] text-[var(--color-text-primary)] antialiased">
        <LanguageProvider>{children}</LanguageProvider>
        {/* Registers public/sw.js — required for Chrome to treat this as
            installable at all (Safari's Add to Dock doesn't need this). */}
        <Script id="sw-register" strategy="afterInteractive">
          {`
            if ('serviceWorker' in navigator) {
              window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js');
              });
            }
          `}
        </Script>
      </body>
    </html>
  );
}
