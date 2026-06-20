import { type NextRequest, NextResponse } from "next/server";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

// ─── Routes that do NOT require authentication ────────────────────────────────
const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/forgot-password",   // unauthenticated password reset request
  "/reset-password",    // unauthenticated password reset confirmation
  "/auth",              // Supabase OAuth callback (/auth/callback)
  "/pay",               // debtor-facing payment page (limited data only)
  "/acknowledge",       // debtor-facing debt acknowledgement (limited data only)
  "/beta-welcome",      // public beta welcome / landing page
  "/landing",           // public marketing landing page
  "/terms",             // public legal pages
  "/privacy",
  "/legal-disclaimer",
  "/pdpa-consent",
  "/support",
  "/_next",
  "/favicon",
  "/manifest",
  "/icons",
];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // If Supabase is not configured (dev / mock mode), allow all routes
  if (!isSupabaseConfigured) {
    return NextResponse.next();
  }

  // Always allow public routes
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // Check auth session via Supabase SSR
  try {
    const { createServerClient } = await import("@supabase/ssr");

    let response = NextResponse.next({ request });

    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("redirect", pathname);
      return NextResponse.redirect(url);
    }

    return response;
  } catch {
    // On error, allow through — don't block the app
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|icons).*)",
  ],
};
