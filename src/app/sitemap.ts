import type { MetadataRoute } from "next";
import { getAppUrl } from "@/lib/app-url";

// Public pages only; keep in step with the `allow` list in robots.ts.
const PUBLIC_PAGES: Array<{ path: string; changeFrequency: "weekly" | "monthly" | "yearly"; priority: number }> = [
  { path: "/landing", changeFrequency: "weekly", priority: 1 },
  { path: "/signup", changeFrequency: "monthly", priority: 0.8 },
  { path: "/login", changeFrequency: "yearly", priority: 0.5 },
  { path: "/support", changeFrequency: "monthly", priority: 0.6 },
  { path: "/glossary", changeFrequency: "monthly", priority: 0.5 },
  { path: "/status", changeFrequency: "weekly", priority: 0.4 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/legal-disclaimer", changeFrequency: "yearly", priority: 0.3 },
  { path: "/pdpa-consent", changeFrequency: "yearly", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const appUrl = getAppUrl();
  return PUBLIC_PAGES.map(({ path, changeFrequency, priority }) => ({
    url: `${appUrl}${path}`,
    changeFrequency,
    priority,
  }));
}
