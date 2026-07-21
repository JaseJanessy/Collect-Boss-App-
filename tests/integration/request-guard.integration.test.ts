import { describe, expect, it } from "vitest";
import { clientAddress, isRateLimited, requestHasAllowedOrigin } from "@/lib/api/request-guard";

describe("server request guard", () => {
  it("uses the platform address, enforces a rate window, and rejects a cross-origin browser request", () => {
    const headers = new Headers({
      "x-vercel-forwarded-for": "198.51.100.24",
      "x-forwarded-for": "203.0.113.9",
    });
    expect(clientAddress(headers)).toBe("198.51.100.24");
    expect(isRateLimited("integration:rate-window", 2, 60_000, 1_000)).toBe(false);
    expect(isRateLimited("integration:rate-window", 2, 60_000, 1_001)).toBe(false);
    expect(isRateLimited("integration:rate-window", 2, 60_000, 1_002)).toBe(true);
    expect(requestHasAllowedOrigin("https://attacker.example", "https://app.example")).toBe(false);
  });
});
