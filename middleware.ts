import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  // Standard Supabase SSR pattern: build a response we can attach cookies to,
  // then create a server client that reads/writes cookies on that response.
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Mirror cookies onto the request for downstream use
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          // Re-create the response so it carries the refreshed session cookies
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: calling getUser() here refreshes the session cookie if it has
  // expired. Do NOT remove this call — it is load-bearing for session refresh.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Routes that don't require a session
  const isPublic =
    pathname.startsWith("/auth") ||
    // Signed-out visitors land on /auth with no idea what the app does —
    // this lets the "Learn more" button there send them to /instructions
    // without bouncing straight back to /auth.
    pathname.startsWith("/instructions") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    // Bearer-token authed (browser extension) — no session cookie to check
    // here, they do their own auth in-route. Redirecting these to /auth
    // instead of running the handler is what broke the extension.
    pathname.startsWith("/api/extension") ||
    // The PWA manifest and the icons it references. <link rel="manifest">
    // and icon fetches never send cookies, even from an already-signed-in
    // tab — without this they hit here as if logged out, get 307'd to
    // /auth, and the browser tries to parse that redirect as JSON
    // ("Manifest: ... Syntax error" in the console) or as an image.
    pathname === "/manifest.webmanifest" ||
    pathname === "/icon.png" ||
    pathname === "/apple-icon.png" ||
    pathname.startsWith("/icons/");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  // Run on every request except static assets and Next.js internals
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
