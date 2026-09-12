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
