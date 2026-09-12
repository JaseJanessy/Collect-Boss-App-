import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ event: "SIGNED_IN", listener: null as ((event: string) => void) | null, provision: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ isSupabaseConfigured: true, SUPABASE_URL: "https://offline.example.test", SUPABASE_ANON_KEY: "test-only" }));
vi.mock("@/lib/workspace/registration", () => ({ provisionRegisteredWorkspace: state.provision }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: vi.fn() }) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: {
  onAuthStateChange: (listener: (event: string) => void) => { state.listener = listener; return { data: { subscription: { unsubscribe: state.unsubscribe } } }; },
  exchangeCodeForSession: async () => { state.listener?.(state.event); return { data: { user: { id: "test" } }, error: null }; },
} }) }));
import { GET } from "@/app/auth/callback/route";

describe("PKCE recovery callback", () => {
  beforeEach(() => { state.event = "SIGNED_IN"; state.provision.mockReset(); });
  it("rejects a normal confirmation code relabelled as password recovery", async () => {
    const result = await GET(new NextRequest("https://app.example.test/auth/callback?code=test&next=%2Freset-password"));
    expect(result.headers.get("location")).toContain("auth_callback_failed");
    expect(result.cookies.get("cb-password-recovery")).toBeUndefined();
  });
  it("allows verified recovery independently of workspace provisioning", async () => {
    state.event = "PASSWORD_RECOVERY";
    state.provision.mockRejectedValue(new Error("schema unavailable"));
    const result = await GET(new NextRequest("https://app.example.test/auth/callback?code=test&next=%2Freset-password"));
    expect(result.headers.get("location")).toBe("https://app.example.test/reset-password");
    expect(result.cookies.get("cb-password-recovery")).toMatchObject({ value: "1", httpOnly: true, maxAge: 600, sameSite: "strict" });
    expect(state.provision).not.toHaveBeenCalled();
    expect(state.unsubscribe).toHaveBeenCalled();
  });
  it("surfaces provisioning failure after normal email confirmation", async () => {
    state.provision.mockRejectedValue(new Error("schema unavailable"));
    const result = await GET(new NextRequest("https://app.example.test/auth/callback?code=test"));
    expect(result.headers.get("location")).toContain("error=workspace_unavailable");
  });
  it("does not follow an external next URL", async () => {
    const result = await GET(new NextRequest("https://app.example.test/auth/callback?code=test&next=https://other.example.test"));
    expect(result.headers.get("location")).toBe("https://app.example.test/");
  });
  it("rejects callbacks without an exchange code", async () => {
    const result = await GET(new NextRequest("https://app.example.test/auth/callback"));
    expect(result.headers.get("location")).toContain("auth_callback_failed");
  });
});
