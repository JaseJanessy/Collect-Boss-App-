import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ signInWithPassword: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ isSupabaseConfigured: true, getBrowserClient: () => ({ auth }) }));
vi.mock("@collectboss/registration-contracts", () => ({ readUserRegistration: () => null }));
import { signIn, signOut } from "@/lib/auth/session";

describe("live-configured auth failure boundaries (offline doubles)", () => {
  beforeEach(() => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: { id: "test" }, session: { access_token: "test-only-token" } }, error: null });
    vi.stubGlobal("window", { location: { href: "/" } });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("separates successful authentication from an unavailable workspace", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "WORKSPACE_CONTEXT_UNAVAILABLE" }), { status: 503 })));
    expect(await signIn("qa@example.test", "test-only")).toMatchObject({ success: false, error: expect.stringContaining("login was accepted") });
  });
  it("routes a confirmed missing membership to product selection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "WORKSPACE_ACCESS_DENIED" }), { status: 403 })));
    expect(await signIn("qa@example.test", "test-only")).toEqual({ success: true, requiresProductSelection: true });
  });
  it("does not reinterpret a network failure as successful login", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await signIn("qa@example.test", "test-only")).toMatchObject({ success: false });
  });
  it("accepts a successfully verified workspace", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    expect(await signIn("qa@example.test", "test-only")).toEqual({ success: true });
  });
  it("does not accept an auth response without a session", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: null });
    expect(await signIn("qa@example.test", "test-only")).toMatchObject({ success: false });
  });
  it("does not redirect as if signed out when Supabase reports failure", async () => {
    auth.signOut.mockResolvedValue({ error: { message: "offline" } });
    await expect(signOut()).rejects.toThrow("could not complete sign out");
    expect(window.location.href).toBe("/");
  });
});
