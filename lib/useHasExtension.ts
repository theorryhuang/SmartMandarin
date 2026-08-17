"use client";

import { useEffect, useState } from "react";

const EXTENSION_MARKER_ATTR = "data-smartmandarin-ext";

/**
 * True once the SmartMandarin browser extension's content script has marked
 * itself present on *this* page (see browser-extension/content.js, which sets
 * the marker attribute unconditionally on every page it runs on). Desktop
 * pointer users should defer to the extension's own popup only when it's
 * actually installed and active here — a different browser, a profile
 * without it, or simply not having it installed must fall back to this app's
 * own popup instead of showing nothing.
 *
 * Starts false and flips true once/if the marker shows up — the content
 * script runs at document_idle, so it can lag this app's own first paint by
 * a beat; a MutationObserver (not just a one-time check) catches that.
 */
export function useHasExtension(): boolean {
  const [hasExtension, setHasExtension] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    if (root.hasAttribute(EXTENSION_MARKER_ATTR)) {
      setHasExtension(true);
      return;
    }
    const observer = new MutationObserver(() => {
      if (root.hasAttribute(EXTENSION_MARKER_ATTR)) {
        setHasExtension(true);
        observer.disconnect();
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: [EXTENSION_MARKER_ATTR] });
    return () => observer.disconnect();
  }, []);

  return hasExtension;
}
