const windows = new Map<string, number[]>();

export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const platformAddress = headers.get("x-vercel-forwarded-for")?.trim();
  return platformAddress || forwarded || "unknown";
}

/** Per-process fallback limiter. Deploy a shared provider before multi-instance launch. */
export function isRateLimited(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const since = now - windowMs;
  const recent = (windows.get(key) ?? []).filter((timestamp) => timestamp > since);
  if (recent.length >= limit) {
    windows.set(key, recent);
    return true;
  }
  recent.push(now);
  windows.set(key, recent);
  return false;
}

export function requestHasAllowedOrigin(origin: string | null, expectedOrigin: string): boolean {
  // Non-browser clients do not send Origin. Authentication and token checks are
  // still enforced in handlers; browser mutations must be same-origin.
  return origin === null || origin === expectedOrigin;
}
