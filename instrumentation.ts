import * as Sentry from "@sentry/nextjs";

// Next.js instrumentation hook — runs once per runtime on cold start.
// Loads the right Sentry init for whichever runtime this process is
// (middleware.ts runs on "edge"; everything else — API routes, server
// actions, server components — runs on "nodejs").
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Catches errors Next's App Router surfaces through its own error channel
// (nested error boundaries, some server-action failures) that wouldn't
// otherwise reach Sentry.
export const onRequestError = Sentry.captureRequestError;
