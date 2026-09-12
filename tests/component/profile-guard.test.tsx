// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  loading: true,
  user: null as { id: string; email: string } | null,
  initializationError: null as string | null,
}));

const navigationState = vi.hoisted(() => ({ pathname: "/landing", push: vi.fn() }));
const configuration = vi.hoisted(() => ({ isSupabaseConfigured: false }));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => authState,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
  useRouter: () => ({ push: navigationState.push }),
}));

vi.mock("@/lib/supabase/client", () => configuration);

import { ProfileGuard } from "@/components/layout/profile-guard";

describe("ProfileGuard route boundaries", () => {
  beforeEach(() => {
    authState.loading = true;
    authState.user = null;
    authState.initializationError = null;
    navigationState.pathname = "/landing";
    configuration.isSupabaseConfigured = false;
    navigationState.push.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders public content without waiting for auth initialization", () => {
    render(<ProfileGuard><main>Public landing content</main></ProfileGuard>);
    expect(screen.getByRole("main").textContent).toBe("Public landing content");
  });

  it("keeps protected content behind the initialization state", () => {
    navigationState.pathname = "/cases";
    render(<ProfileGuard><main>Protected cases</main></ProfileGuard>);
    expect(screen.queryByText("Protected cases")).toBeNull();
  });

  it("offers a retry instead of an endless protected-route spinner", () => {
    navigationState.pathname = "/cases";
    authState.loading = false;
    authState.initializationError = "CollectBoss could not verify your session. Please retry.";
    render(<ProfileGuard><main>Protected cases</main></ProfileGuard>);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("does not send an existing account to onboarding during a profile outage", async () => {
    navigationState.pathname = "/cases";
    authState.loading = false;
    authState.user = { id: "qa", email: "qa@example.test" };
    configuration.isSupabaseConfigured = true;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 503 })));
    render(<ProfileGuard><main>Protected cases</main></ProfileGuard>);
    await screen.findByRole("alert");
    expect(navigationState.push).not.toHaveBeenCalled();
    expect(screen.queryByText("Protected cases")).toBeNull();
  });
});
