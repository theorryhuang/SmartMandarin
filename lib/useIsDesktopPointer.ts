"use client";

import { useEffect, useState } from "react";

/**
 * True on devices with a real mouse (precise pointer + genuine hover) — the
 * signal used to decide who owns word lookups on this page: the browser
 * extension on desktop (it needs native text selection to work, and duplicates
 * this app's own popup if both run), this app's own tap-to-open popup
 * everywhere else (phones/tablets, where the extension generally doesn't run
 * anyway, and where the extension's drag-to-select model is worse than
 * tapping a token). Reactive, not a one-time check — a device's pointer
 * capability can change (e.g. a tablet gaining a mouse).
 */
export function useIsDesktopPointer(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    setIsDesktop(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
}
