import type { MetadataRoute } from "next";

import { brandTokens } from "../../../shared/brand-tokens.ts";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CollectBoss Pocket",
    short_name: "Boss Pocket",
    description: "A simple way to track customer debts and payments.",
    start_url: "/pocket",
    scope: "/pocket",
    display: "standalone",
    background_color: brandTokens.pocket.canvas,
    theme_color: brandTokens.brand.navy,
    icons: [
      { src: "/brand/pocket-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/pocket-icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/pocket-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
