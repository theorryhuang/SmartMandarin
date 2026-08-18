// Sentry init for the browser. Next.js file-convention name — picked up
// automatically at build time, no manual import needed anywhere else.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Keep both low — this is an error-tracking install, not perf/replay
  // tooling. Raise tracesSampleRate later if you actually want latency
  // traces; session replay stays off (voice/chat app, don't want to
  // accidentally capture conversation content in a replay recording).
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  enabled: process.env.NODE_ENV === "production",
});

// Required export: lets the SDK track App Router client-side navigations
// as part of error context (which page an error happened on).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
