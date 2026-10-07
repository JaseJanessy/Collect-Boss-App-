/**
 * Origins of the public marketing website that may call the public contact
 * endpoint cross-origin. Configure as a comma-separated list, e.g.
 * MARKETING_SITE_ORIGINS=https://collectboss.com,https://www.collectboss.com
 */
export function marketingSiteOrigins(): string[] {
  return (process.env.MARKETING_SITE_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter((value) => /^https?:\/\/[^/\s]+$/.test(value));
}

export function isMarketingSiteOrigin(origin: string | null): origin is string {
  return Boolean(origin) && marketingSiteOrigins().includes(origin as string);
}

export const PUBLIC_CONTACT_PATH = "/api/public/contact";
