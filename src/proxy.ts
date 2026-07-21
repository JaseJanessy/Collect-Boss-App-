import { type NextRequest, NextResponse } from "next/server";
import {
  APP_URL,
  isAppUrlConfigured,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  isSupabaseConfigured,
  isMockDataEnabled,
} from "@/lib/supabase/client";
import { clientAddress, isRateLimited, requestHasAllowedOrigin } from "@/lib/api/request-guard";

// ─── Routes that do NOT require authentication ────────────────────────────────
const PUBLIC_PAGE_PREFIXES = [
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

// These are capability-token routes. They are intentionally narrower than a
// blanket `/api/public` exemption so future public API endpoints do not become
// reachable without an explicit proxy review.
const PUBLIC_API_PREFIXES = [
  "/api/public/pay",
  "/api/public/acknowledge",
  "/api/stripe/webhook", // Stripe authenticates this route with its webhook signature
];

const API_PREFIX = "/api/";
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MAX_API_BODY_BYTES = 1_000_000;
const MAX_UPLOAD_BODY_BYTES = 12 * 1024 * 1024;
const RATE_WINDOW_MS = 60_000;

function isPublicRoute(pathname: string): boolean {
  return [...PUBLIC_PAGE_PREFIXES, ...PUBLIC_API_PREFIXES].some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

function apiError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } },
  );
}

function isUploadPath(pathname: string): boolean {
  return pathname.endsWith("/proof") || pathname.endsWith("/evidence");
}

function guardApiRequest(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith(API_PREFIX)) return null;
  const isStripeWebhook = pathname === "/api/stripe/webhook";

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  const maximumBodyBytes = isUploadPath(pathname) ? MAX_UPLOAD_BODY_BYTES : MAX_API_BODY_BYTES;
  if (Number.isFinite(contentLength) && contentLength > maximumBodyBytes) {
    return apiError("Request payload is too large.", 413);
  }

  if (UNSAFE_METHODS.has(request.method) && !isStripeWebhook) {
    const expectedOrigin = APP_URL && isAppUrlConfigured ? new URL(APP_URL).origin : request.nextUrl.origin;
    if (!requestHasAllowedOrigin(request.headers.get("origin"), expectedOrigin)) {
      return apiError("Request origin is not allowed.", 403);
    }

    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    const expectsFormData = isUploadPath(pathname);
    const validContentType = expectsFormData
      ? contentType.startsWith("multipart/form-data")
      : contentType.startsWith("application/json");
    if (contentLength > 0 && !validContentType) return apiError("Unsupported request content type.", 415);
  }

  // Stripe authenticates with its signature header rather than browser origin.
  if (isStripeWebhook) return null;

  const address = clientAddress(request.headers);
  const isPublicCapability = pathname.startsWith("/api/public/");
  const limit = isPublicCapability ? 20 : 240;
  const key = `${isPublicCapability ? "public" : "authenticated"}:${address}`;
  if (isRateLimited(key, limit, RATE_WINDOW_MS)) {
    return apiError("Too many requests. Please try again shortly.", 429);
  }
  return null;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const apiGuard = guardApiRequest(request);
  if (apiGuard) return apiGuard;

  // Mock mode is an explicit development-only opt-in. A missing production
  // configuration is blocked in the shared Supabase runtime guard.
  if (isMockDataEnabled && !isSupabaseConfigured) {
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
    // Fail closed if session verification is unavailable. Allowing the request
    // through here would expose protected routes during an auth outage.
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|icons).*)",
  ],
};
