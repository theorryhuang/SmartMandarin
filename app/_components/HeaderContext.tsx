"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";

export interface HeaderOverride {
  /** Custom back handler — falls back to the route's default when omitted. */
  onClick?: () => void;
  /** Custom back button text — falls back to the route default / t.back. */
  label?: string;
  /** Replaces the back label with custom content (e.g. a chat's avatar +
   *  title), rendered next to the (icon-only, in that case) back chevron. */
  center?: ReactNode;
  /** Extra buttons appended to the header's right-hand cluster, before the
   *  streak chip / language switcher / profile / home. */
  actions?: ReactNode;
}

type SetOverrideFn = (id: string, override: HeaderOverride | null) => void;

// Split into two contexts on purpose — this is what keeps
// useHeaderOverride's writers from re-rendering themselves into an
// infinite loop. setOverride (useCallback, empty deps) never changes
// identity, so subscribing to *only* it doesn't re-render a writer just
// because the override value it (or anyone else) wrote changed. If both
// were bundled in one context object (as they used to be), every write
// would hand writers a new context value, re-rendering them, which — since
// useHeaderOverride's effect has no dependency array (see below) — would
// immediately write again, forever. AppHeader is the only thing that needs
// the actual value, so it's the only thing subscribed to it.
const SetOverrideContext = createContext<SetOverrideFn | null>(null);
const OverrideValueContext = createContext<HeaderOverride | null>(null);

export function HeaderProvider({ children }: { children: ReactNode }) {
  // Keyed by a caller-supplied id, last-write-wins — a stack isn't needed
  // since only one stateful view (e.g. ReviewSession, a chat page's own
  // title/actions) is ever mounted and overriding at a time.
  const [entries, setEntries] = useState<Map<string, HeaderOverride>>(new Map());

  const setOverride = useCallback<SetOverrideFn>((id, override) => {
    setEntries((prev) => {
      const next = new Map(prev);
      if (override) next.set(id, override);
      else next.delete(id);
      return next;
    });
  }, []);

  const override = entries.size > 0 ? [...entries.values()].at(-1)! : null;

  return (
    <SetOverrideContext.Provider value={setOverride}>
      <OverrideValueContext.Provider value={override}>
        {children}
      </OverrideValueContext.Provider>
    </SetOverrideContext.Provider>
  );
}

/** Only AppHeader itself reads the current override. */
export function useHeaderOverrideValue(): HeaderOverride | null {
  return useContext(OverrideValueContext);
}

/**
 * Lets a page customize the global header for as long as it stays mounted —
 * a custom Back target/label (e.g. exit an active review session back to
 * its picker, not browser-back), and/or custom center content and extra
 * action buttons (e.g. a chat page's avatar/title and its list/call
 * buttons, merged into the one global bar instead of a second local one).
 * Automatically clears on unmount so a stale override never lingers into
 * the next page.
 *
 * `id` should be a stable string unique to the call site (component name is
 * fine — there's only ever one override active at a time).
 *
 * `override` should be reference-stable across renders where nothing
 * actually changed — wrap `center`/`actions` (and the object itself) in
 * `useMemo` when they're JSX, otherwise this re-registers every render.
 * That's still safe (this hook only subscribes to the stable setter — see
 * the two-context split above — so a caller re-rendering more or less
 * often can't loop back on itself), just wasteful for a page that
 * re-renders often (e.g. a streaming transcript) and hasn't memoized.
 */
export function useHeaderOverride(id: string, override: HeaderOverride | null) {
  const setOverride = useContext(SetOverrideContext);
  if (!setOverride) throw new Error("useHeaderOverride must be used within HeaderProvider");
  useEffect(() => {
    setOverride(id, override);
    return () => setOverride(id, null);
  }, [id, override, setOverride]);
}
