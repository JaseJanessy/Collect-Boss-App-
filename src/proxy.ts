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
import { isMarketingSiteOrigin, PUBLIC_CONTACT_PATH } from "@/lib/api/marketing-origins";
import { requiredPermissionForPath } from "@collectboss/navigation";
import { productHomePath, productOwnsProtectedPath } from "@collectboss/workspace-contracts";

// ─── Routes that do NOT require authentication ────────────────────────────────
const PUBLIC_PAGE_PREFIXES = [
  "/login",
  "/signup",
  "/forgot-password",   // unauthenticated password reset request
  "/reset-password",    // unauthenticated password reset confirmation
  "/auth",              // Supabase OAuth callback (/auth/callback)
  "/pay",               // debtor-facing payment page (limited data only)
  "/acknowledge",       // debtor-facing debt acknowledgement (limited data only)
  "/landing",           // public marketing landing page
  "/terms",             // public legal pages
  "/privacy",
  "/legal-disclaimer",
  "/pdpa-consent",
  "/support",
  "/status",
  "/glossary",
  "/workspace-unavailable",
  "/_next",
  "/favicon",
  "/manifest",
  "/manifest.webmanifest",        // browsers fetch manifests without credentials
  "/pocket/manifest.webmanifest",
  "/favicon.svg",
  "/robots.txt",
  "/sitemap.xml",
  "/icons",
  "/brand",             // public wordmarks, icons, and install assets
];

// These are capability-token routes. They are intentionally narrower than a
// blanket `/api/public` exemption so future public API endpoints do not become
// reachable without an explicit proxy review.
const PUBLIC_API_PREFIXES = [
  "/api/public/pay",
  "/api/public/acknowledge",
  PUBLIC_CONTACT_PATH,   // marketing-site enquiries; origin allowlist + shared rate limit
  "/api/stripe/webhook", // Stripe authenticates this route with its webhook signature
  "/api/stripe/connect-webhook", // Stripe Connect events, same signature scheme
  "/api/webhooks/resend", // Resend authenticates with the raw-body Svix signature
  "/api/webhooks/whatsapp", // Meta authenticates with the X-Hub-Signature-256 HMAC
  "/api/cron",           // Scheduled routes authenticate with CRON_SECRET
];

const API_PREFIX = "/api/";
const POCKET_API_PREFIXES = [
  "/api/pocket",
  "/api/workspace/context",
  "/api/document-intakes",
  "/api/notifications",
  "/api/profile",
  "/api/region-settings",
  "/api/navigation",
  "/api/feedback",
] as const;
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MAX_API_BODY_BYTES = 1_000_000;
const MAX_UPLOAD_BODY_BYTES = 12 * 1024 * 1024;
const RATE_WINDOW_MS = 60_000;
const DOCUMENT_INTAKE_RATE_WINDOW_MS = 10 * 60_000;

function documentIntakeRateLimit(pathname: string, method: string) {
  if (!pathname.startsWith("/api/document-intakes")) return null;
  if (pathname === "/api/document-intakes" && method === "POST") return { scope: "create", limit: 30 };
  if (method === "POST" && (pathname.endsWith("/evidence") || pathname.endsWith("/replace"))) return { scope: "upload", limit: 20 };
  if (method === "POST" && pathname.endsWith("/extraction")) return { scope: "extract", limit: 10 };
  if (method === "GET" && pathname.endsWith("/preview")) return { scope: "preview", limit: 120 };
  if (pathname.endsWith("/workflow") && method === "POST") return { scope: "final-submit", limit: 20 };
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) return { scope: "write", limit: 60 };
  return { scope: "read", limit: 180 };
}

function isPublicRoute(pathname: string): boolean {
  return [...PUBLIC_PAGE_PREFIXES, ...PUBLIC_API_PREFIXES].some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

function apiError(message: string, status: number, code?: string) {
  return NextResponse.json(
    { error: message, ...(code ? { code } : {}) },
    { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } },
  );
}

function pocketOwnsApiPath(pathname: string): boolean {
  return POCKET_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function productTypeFromWorkspaceContext(value: unknown): "main" | "pocket" | null {
  const record = Array.isArray(value) ? value[0] : value;
  if (!record || typeof record !== "object") return null;
  const productType = (record as { product_type?: unknown }).product_type;
  return productType === "main" || productType === "pocket" ? productType : null;
}

const BEARER_VERIFIED_API_PATHS = ["/api/workspace/context", "/api/workspace/provision", "/api/pocket/entitlements"];
const BEARER_VERIFIED_API_PREFIXES = ["/api/document-intakes", "/api/mobile", "/api/payment-matching/transactions"];

function bearerVerifiedApiPath(pathname: string): boolean {
  return BEARER_VERIFIED_API_PATHS.includes(pathname)
    || BEARER_VERIFIED_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isUploadPath(pathname: string): boolean {
  return pathname.endsWith("/proof") || pathname.endsWith("/evidence") || pathname.endsWith("/qr")
    || pathname.endsWith("/replace") || pathname === "/api/operations/import";
}

function guardApiRequest(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith(API_PREFIX)) return null;
  const isStripeWebhook = pathname === "/api/stripe/webhook" || pathname === "/api/stripe/connect-webhook";
  const isSignedWebhook = pathname === "/api/webhooks/resend" || pathname === "/api/webhooks/whatsapp";
  const isScheduledJob = pathname.startsWith("/api/cron/");
  const hasServerAuthentication = isStripeWebhook || isSignedWebhook || isScheduledJob;

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  const maximumBodyBytes = isUploadPath(pathname) ? MAX_UPLOAD_BODY_BYTES : MAX_API_BODY_BYTES;
  if (Number.isFinite(contentLength) && contentLength > maximumBodyBytes) {
    return apiError("Request payload is too large.", 413);
  }

  if (UNSAFE_METHODS.has(request.method) && !hasServerAuthentication) {
    const expectedOrigin = APP_URL && isAppUrlConfigured ? new URL(APP_URL).origin : request.nextUrl.origin;
    const origin = request.headers.get("origin");
    const marketingContact = pathname === PUBLIC_CONTACT_PATH && isMarketingSiteOrigin(origin);
    if (!marketingContact && !requestHasAllowedOrigin(origin, expectedOrigin)) {
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
  if (isStripeWebhook || isSignedWebhook) return null;

  const address = clientAddress(request.headers);
  const documentLimit = documentIntakeRateLimit(pathname, request.method);
  if (documentLimit && isRateLimited(
    `document-intake:${documentLimit.scope}:${address}`,
    documentLimit.limit,
    DOCUMENT_INTAKE_RATE_WINDOW_MS,
  )) {
    return apiError("Too many document requests. Please try again later.", 429);
  }
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

  if (process.env.NODE_ENV !== "development"
    && (pathname === "/dev/billing-debug" || pathname === "/dev/pocket-ux")) {
    return new NextResponse("Not Found", {
      status: 404,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const apiGuard = guardApiRequest(request);
  if (apiGuard) return apiGuard;

  // The former beta welcome route is retired in every environment.
  if (pathname === "/beta-welcome") {
    return NextResponse.redirect(new URL("/", request.url), 308);
  }

  // These endpoints perform their own bearer-token verification and permission
  // check in the route handler. Cookie-only Proxy auth would reject Expo.
  if (bearerVerifiedApiPath(pathname)
    && (request.headers.get("authorization") ?? "").startsWith("Bearer ")) {
    return NextResponse.next();
  }

  // Mock mode is an explicit development-only opt-in. A missing production
  // configuration is blocked in the shared Supabase runtime guard.
  if (isMockDataEnabled && !isSupabaseConfigured) {
    return NextResponse.next();
  }

  // The root route performs its own server-side user verification. It renders
  // the application only for a verified workspace and otherwise redirects to
  // the public landing page. Letting it run avoids sending first-time visitors
  // straight to the login form.
  const isAuthEntry = pathname === "/" || pathname === "/login" || pathname === "/signup";
  const hasAuthCookie = request.cookies.getAll().some(({ name }) => /^sb-.+-auth-token(?:\.\d+)?$/.test(name));
  if (isAuthEntry && !hasAuthCookie) {
    return NextResponse.next();
  }

  // Always allow public routes
  if (isPublicRoute(pathname) && !isAuthEntry) {
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
      if (isAuthEntry) return response;
      if (pathname.startsWith(API_PREFIX)) return apiError("You must be signed in.", 401, "AUTHENTICATION_REQUIRED");
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      url.searchParams.set("redirect", `${pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(url);
    }

    // Session refresh must reach the response even on account entry pages.
    // Workspace authorization remains in their server-side data boundary.
    if (isAuthEntry) return response;

    const requiredPermission = requiredPermissionForPath(pathname);
    if (requiredPermission) {
      const { data: businessId, error: businessError } = await supabase.rpc("my_business_id");
      const { data: allowed, error: permissionError } = businessId
        ? await supabase.rpc("has_business_permission", {
            p_business_id: businessId,
            p_permission: requiredPermission,
          })
        : { data: false, error: null };

      if (businessError || permissionError) {
        const unavailable = NextResponse.redirect(new URL("/workspace-unavailable", request.url));
        response.cookies.getAll().forEach((cookie) => unavailable.cookies.set(cookie));
        return unavailable;
      }
      if (allowed !== true) {
        const url = request.nextUrl.clone();
        url.pathname = "/";
        url.search = "";
        url.searchParams.set("access", "denied");
        const denied = NextResponse.redirect(url);
        response.cookies.getAll().forEach((cookie) => denied.cookies.set(cookie));
        return denied;
      }
    }

    // This is an optimistic product-routing boundary. Pocket route handlers
    // repeat authorization close to data access; this also prevents a Pocket
    // session from calling a Main-only API directly.
    // Missing schema is an availability failure, never permission to bypass
    // the product boundary.
    if (!pathname.startsWith("/onboarding/") && pathname !== "/" && pathname !== "/choose-product") {
      const { data: workspaceContext, error: workspaceError } = await supabase.rpc("my_workspace_context");
      if (workspaceError) {
        if (pathname.startsWith(API_PREFIX)) return apiError("Workspace access is temporarily unavailable.", 503, "WORKSPACE_CONTEXT_UNAVAILABLE");
        const unavailable = NextResponse.redirect(new URL("/workspace-unavailable", request.url));
        response.cookies.getAll().forEach((cookie) => unavailable.cookies.set(cookie));
        return unavailable;
      }
      const productType = workspaceError ? null : productTypeFromWorkspaceContext(workspaceContext);
      if (productType === "pocket" && pathname.startsWith("/api/") && !pocketOwnsApiPath(pathname)) {
        return apiError("This action is not available in CollectBoss Pocket.", 403, "PLAN_NOT_AUTHORISED");
      }
      const target = productType && !productOwnsProtectedPath(productType, pathname)
        && !pathname.startsWith("/api/")
        ? productHomePath(productType)
        : null;
      if (target) {
        const url = request.nextUrl.clone();
        url.pathname = target;
        url.search = "";
        const productRedirect = NextResponse.redirect(url);
        response.cookies.getAll().forEach((cookie) => productRedirect.cookies.set(cookie));
        return productRedirect;
      }
    }

    return response;
  } catch {
    // Fail closed if session verification is unavailable. Allowing the request
    // through here would expose protected routes during an auth outage.
    if (pathname.startsWith(API_PREFIX)) return apiError("Session verification is temporarily unavailable.", 503, "AUTH_SERVICE_UNAVAILABLE");
    return NextResponse.redirect(new URL("/workspace-unavailable", request.url));
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|icons|brand).*)",
  ],
};
