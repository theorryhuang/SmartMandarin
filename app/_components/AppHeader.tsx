"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { ChevronLeft, Flame } from "lucide-react";
import { useLanguage } from "./LanguageContext";
import { useHeaderOverrideValue } from "./HeaderContext";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { HomeButton } from "./HomeButton";
import { ProfileButton } from "./ProfileButton";
import { createClient } from "@/lib/supabase/client";
import { getDailyStreak } from "@/app/actions/dailyLearning";
import { getFriendNotificationCount } from "@/app/actions/friends";

/** Total rendered height (content + safe area) — kept in sync with the h-14
 *  below. Full-height pages (Conversation) size themselves against
 *  `100dvh - this` instead of a spacer element. */
export const APP_HEADER_OFFSET = "calc(56px + env(safe-area-inset-top))";

interface RouteConfig {
  hidden?: boolean;
  hideBack?: boolean;
  backHref?: string;
  backLabel?: string;
  showHome?: boolean;
  showProfile?: boolean;
  showStreak?: boolean;
}

function getRouteConfig(
  pathname: string,
  searchParams: URLSearchParams,
  signedIn: boolean,
  backToSetupLabel: string
): RouteConfig {
  // Auth/Onboarding are intentionally bare first-run screens — see their
  // own comments — so no bar there at all. Home shows the bar too, just
  // without a Back button (nothing to go back to) or a Home button
  // (already there).
  if (pathname === "/auth" || pathname === "/onboarding") {
    return { hidden: true };
  }
  if (pathname === "/") {
    return { hideBack: true, showHome: false };
  }

  if (pathname === "/instructions") {
    // The only other page reachable signed-out (see middleware.ts) — route
    // Back to /auth and hide the buttons that need a session when there
    // isn't one yet.
    return {
      backHref: signedIn ? "/profile" : "/auth",
      showHome: signedIn,
      showProfile: signedIn,
      showStreak: signedIn,
    };
  }

  if (pathname === "/profile") return { backHref: "/", showProfile: false };
  if (pathname === "/friends") return { backHref: "/profile" };
  if (pathname === "/reader" || pathname === "/assessment") return { backHref: "/" };
  if (pathname === "/conversation") return { backHref: "/" };

  if (pathname.startsWith("/settings/")) {
    const fromOnboarding = searchParams.get("from") === "onboarding";
    return {
      backHref: fromOnboarding ? "/onboarding" : "/profile",
      backLabel: fromOnboarding ? backToSetupLabel : undefined,
    };
  }

  if (pathname === "/vocab") {
    return searchParams.get("q") ? {} : { backHref: "/" };
  }

  // /vocab/word/[hanzi], /daily, /review, and anything else: plain
  // router.back(), every button shown. /daily and /review's own stateful
  // views (an active review session, the sub-filter step) override Back
  // themselves via useHeaderOverride while they're on screen — as does
  // Conversation, which merges its own title/actions in too.
  return {};
}

export function AppHeader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t } = useLanguage();
  const override = useHeaderOverrideValue();

  // Optimistic true: every route except /instructions requires a session
  // anyway (see middleware.ts), so this avoids a Home/Profile flash-hide for
  // the common signed-in case while the check below is still in flight —
  // the rare signed-out /instructions visitor self-corrects a beat later.
  const [signedIn, setSignedIn] = useState(true);
  const [streak, setStreak] = useState(0);
  const [friendNotifCount, setFriendNotifCount] = useState(0);

  const config = getRouteConfig(pathname, searchParams, signedIn, t.backToSetup);

  useEffect(() => {
    if (config.hidden) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      setSignedIn(!!user);
      if (!user) return;
      const [s, notifCount] = await Promise.all([getDailyStreak(), getFriendNotificationCount()]);
      if (cancelled) return;
      setStreak(s.current);
      setFriendNotifCount(notifCount);
    })();
    return () => { cancelled = true; };
    // Re-check on every route change — cheap query, keeps the streak chip
    // from going stale after finishing a daily session elsewhere in the app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, config.hidden]);

  if (config.hidden) return null;

  const showHome = config.showHome ?? true;
  const showProfile = config.showProfile ?? true;
  const showStreak = config.showStreak ?? true;

  function handleBack() {
    if (override?.onClick) return override.onClick();
    if (config.backHref) return router.push(config.backHref);
    router.back();
  }

  const backLabel = override?.label ?? config.backLabel ?? t.back;
  const hasCenter = !!override?.center;

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 bg-[var(--color-surface)] border-b border-[var(--color-border)]"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="h-14 flex items-center gap-1 px-2">
        {!config.hideBack && (
          <button
            onClick={handleBack}
            className="flex items-center gap-1 h-9 pl-2 pr-3 -ml-2 rounded-full text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)] transition-colors flex-shrink-0"
          >
            <ChevronLeft size={18} />
            {/* A page providing center content (e.g. a chat's avatar/title)
                gets that instead of the text label — there isn't room for both. */}
            {!hasCenter && backLabel}
          </button>
        )}

        {/* Fills the middle — either a page's custom center content (merged
            in place of a second local header, e.g. Conversation's title),
            or nothing, just pushing the right cluster to the edge. */}
        <div className="flex-1 min-w-0 flex items-center">{override?.center}</div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {override?.actions}
          {showStreak && streak > 0 && (
            <Link
              href="/daily"
              className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--color-background)] border border-[var(--color-border)] text-amber-600 text-xs font-semibold hover:border-amber-300 transition-colors"
            >
              <Flame size={13} className="fill-amber-500 text-amber-500" />
              {streak}
            </Link>
          )}
          <LanguageSwitcher />
          {showProfile && <ProfileButton badge={friendNotifCount > 0 ? friendNotifCount : null} />}
          {showHome && <HomeButton />}
        </div>
      </div>
    </header>
  );
}
