import type { MetadataRoute } from "next";

import { brandTokens } from "@/lib/brand/theme";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CollectBoss",
    short_name: "CollectBoss",
    description: "Collect Smart. Recover Better.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: brandTokens.background,
    theme_color: brandTokens.brand.navy,
    categories: ["finance", "business"],
    lang: "en-MY",
    icons: [
      { src: "/brand/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
