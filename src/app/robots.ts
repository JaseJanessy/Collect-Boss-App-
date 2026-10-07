import type { MetadataRoute } from "next";
import { getAppUrl } from "@/lib/app-url";

// Only the public marketing, legal and help pages are indexable. Everything
// else needs a signed-in workspace, and capability-token links (/pay,
// /acknowledge) must never be indexed.
export default function robots(): MetadataRoute.Robots {
  const appUrl = getAppUrl();
  return {
    rules: {
      userAgent: "*",
      allow: ["/landing", "/signup", "/login", "/terms", "/privacy", "/legal-disclaimer", "/pdpa-consent", "/support", "/status", "/glossary"],
      disallow: ["/"],
    },
    sitemap: `${appUrl}/sitemap.xml`,
  };
}
