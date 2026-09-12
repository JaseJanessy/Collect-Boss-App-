import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("public and authentication QA regressions", () => {
  it("keeps root and public brand assets out of the login redirect boundary", () => {
    const proxy = read("src/proxy.ts");
    expect(proxy).toContain('pathname === "/"');
    expect(proxy).toContain('"/brand"');
    expect(proxy).toContain('"/status"');
    expect(proxy).toContain('pathname === "/beta-welcome"');
    expect(proxy).toContain('pathname === "/dev/billing-debug"');
    expect(proxy).toContain('pathname === "/dev/pocket-ux"');
    expect(proxy).toContain("status: 404");
  });

  it("exchanges password recovery through the callback and validates the recovery marker", () => {
    const auth = read("src/lib/auth/session.ts");
    const callback = read("src/app/auth/callback/route.ts");
    const resetRoute = read("src/app/reset-password/page.tsx");
    expect(auth).toContain("/auth/callback?next=%2Freset-password");
    expect(callback).toContain('const RECOVERY_COOKIE = "cb-password-recovery"');
    expect(resetRoute).toContain("hasRecoveryMarker && user");
  });

  it("delivers feedback through the server instead of browser storage", () => {
    const feedback = read("src/components/beta/feedback-button.tsx");
    const route = read("src/app/api/feedback/route.ts");
    expect(feedback).toContain('fetch("/api/feedback"');
    expect(feedback).not.toContain("localStorage");
    expect(route).toContain("FEEDBACK_EMAIL_TO");
    expect(route).toContain("getEmailProvider().send");
  });

  it("preserves plan choice and exposes accessible FAQ state", () => {
    const landing = read("src/components/pages/landing-page.tsx");
    const signup = read("src/components/pages/auth/signup-page.tsx");
    expect(landing).toContain("`/signup?plan=${slug}`");
    expect(signup).toContain("selectedPlan");
    expect(landing).toContain("aria-expanded={isOpen}");
    expect(landing).toContain("CollectBoss Pocket");
  });
});
