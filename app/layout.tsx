import type { Metadata, Viewport } from "next";
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
      <head>
        {/* iOS home screen icon */}
        <link rel="apple-touch-icon" sizes="192x192" href="/icons/icon-192.png" />
      </head>
      <body className="min-h-screen bg-[var(--color-background)] text-[var(--color-text-primary)] antialiased">
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
