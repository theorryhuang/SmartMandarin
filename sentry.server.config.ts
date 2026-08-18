// Sentry init for the Node.js server runtime (API routes, server actions,
// server components). Loaded from instrumentation.ts's register().
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  enabled: process.env.NODE_ENV === "production",
});
