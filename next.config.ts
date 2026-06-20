import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
