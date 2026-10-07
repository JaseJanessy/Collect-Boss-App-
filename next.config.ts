import type { NextConfig } from "next";

const deploymentEnvironment = process.env.NEXT_PUBLIC_APP_ENV
  ?? (process.env.NODE_ENV === "production" ? "production" : "development");

if (deploymentEnvironment !== "development") {
  const scannerEndpoint = process.env.DOCUMENT_MALWARE_SCANNER_HTTP_ENDPOINT?.trim() ?? "";
  let scannerUsesHttps = false;
  try { scannerUsesHttps = new URL(scannerEndpoint).protocol === "https:"; } catch { scannerUsesHttps = false; }
  const scannerConfigured = process.env.DOCUMENT_MALWARE_SCANNER_PROVIDER === "http_json"
    && process.env.DOCUMENT_MALWARE_SCANNER_ALLOW_THIRD_PARTY === "true"
    && Boolean(process.env.DOCUMENT_MALWARE_SCANNER_API_KEY?.trim())
    && Boolean(process.env.DOCUMENT_MALWARE_SCANNER_VERSION?.trim())
    && scannerUsesHttps;
  if (!scannerConfigured) {
    throw new Error("[CollectBoss] Blocking configuration error: document malware scanning must be configured for staging and production.");
  }
}

// Content-Security-Policy. The browser only talks to this app and Supabase;
// payments, WhatsApp and accounting providers are reached by navigation or
// server-side calls, not browser fetches. Scripts still need 'unsafe-inline'
// for Next.js bootstrap and the theme script in app/layout.tsx; the other
// directives (framing, plugins, base/form targets, connections) are strict.
function supabaseOrigins(): string[] {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return [url.origin, `wss://${url.host}`];
  } catch {
    return [];
  }
}

const isDevelopmentServer = process.env.NODE_ENV !== "production";
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopmentServer ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  ["img-src 'self' data: blob:", ...supabaseOrigins().filter((origin) => origin.startsWith("https:"))].join(" "),
  "font-src 'self' data:",
  ["connect-src 'self'", ...supabaseOrigins(), ...(isDevelopmentServer ? ["ws:"] : [])].join(" "),
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  ...(deploymentEnvironment === "development" ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
  // Local QA and Playwright use 127.0.0.1 while `next dev` advertises
  // localhost. Allow that development origin so client assets can hydrate.
  allowedDevOrigins: deploymentEnvironment === "development" ? ["127.0.0.1"] : undefined,

  // PDF OCR fallback renders pages with a native Node.js binding. Keep it out
  // of Turbopack's ESM chunks and load the installed platform binary at runtime.
  serverExternalPackages: ["@napi-rs/canvas"],

  // ─── Security headers ───────────────────────────────────────────────────────
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options",    value: "nosniff" },
          { key: "X-Frame-Options",            value: "DENY" },
          { key: "X-XSS-Protection",           value: "1; mode=block" },
          { key: "Referrer-Policy",            value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy",         value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy",    value: contentSecurityPolicy },
        ],
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "Pragma", value: "no-cache" },
          { key: "Vary", value: "Cookie, Authorization" },
        ],
      },
    ];
  },

  // ─── Images ────────────────────────────────────────────────────────────────
  images: {
    remotePatterns: [
      // Supabase Storage — allow only your project's bucket
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/**",
      },
    ],
  },

  // ─── Misc ──────────────────────────────────────────────────────────────────
  // Strict mode helps catch React issues early
  reactStrictMode: true,

  // Compress output
  compress: true,

  // Disable powered-by header
  poweredByHeader: false,
};

export default nextConfig;
