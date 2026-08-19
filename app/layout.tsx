import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Suspense } from "react";
import { cookies } from "next/headers";
import "./globals.css";
import { LanguageProvider } from "./_components/LanguageContext";
import { HeaderProvider } from "./_components/HeaderContext";
import { AppHeader } from "./_components/AppHeader";
import type { Lang } from "@/lib/i18n";

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read the language straight from a cookie so the *server* render is
  // already correct — a client-only localStorage read means the first
  // paint is always the default ("en") and only self-corrects a beat later
  // once an effect fires, which is exactly the "goes back to the wrong
  // setting for a second" flash this was reported as.
  const cookieStore = await cookies();
  const cookieLang = cookieStore.get("sm_lang")?.value;
  const initialLang: Lang = cookieLang === "zh" ? "zh" : "en";

  return (
    <html lang="en" suppressHydrationWarning>
      {/* iOS home screen icon: app/apple-icon.png (Next's file convention)
          injects the <link rel="apple-touch-icon"> automatically, already
          rounded — unlike /icons/icon-192.png which is full-bleed for the
          Android maskable crop and looks over-padded here. */}
      <body className="min-h-screen bg-[var(--color-background)] text-[var(--color-text-primary)] antialiased">
        <LanguageProvider initialLang={initialLang}>
          <HeaderProvider>
            <Suspense fallback={null}>
              <AppHeader />
            </Suspense>
            {children}
          </HeaderProvider>
        </LanguageProvider>
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
