"use client";

// Root-level error boundary. Next's own route-level error.tsx files (if any)
// catch render errors within a route; this one is the last resort — it also
// replaces the root layout while active, so it renders its own <html>/<body>.
// Required by Sentry: React render errors thrown above every route boundary
// don't reach the server-side instrumentation hook, only this one sees them.
import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
