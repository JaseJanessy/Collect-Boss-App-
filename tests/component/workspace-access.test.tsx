// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ isSupabaseConfigured: true }));
vi.mock("@/lib/auth/session", () => ({ signOut: auth.signOut, onAuthStateChange: (callback: (value: object) => void) => { callback({ id: "qa-user", email: "qa@example.test" }); return () => {}; } }));
import { AuthProvider, useAuth } from "@/contexts/auth-context";

function Probe() {
  const state = useAuth();
  return <><p>{state.accessLoading ? "Loading access" : state.accessError ?? state.workspace?.workspace.name}</p><span>{state.hasPermission("case.read") ? "Access granted" : "Access withheld"}</span><button onClick={() => void state.signOut()}>Sign out</button>{state.signOutError && <p role="alert">{state.signOutError}</p>}</>;
}
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status }); }

describe("workspace provider", () => {
  beforeEach(() => { auth.signOut.mockReset(); });
  afterEach(() => vi.unstubAllGlobals());
  it("requires both permissions and verified workspace context", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/navigation"
      ? response({ role: "owner", permissions: ["case.read"] })
      : response({ workspace: { name: "QA company", productType: "main", lifecycleState: "active" }, plan: { slug: "free" } })));
    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText("QA company");
    expect(screen.getByText("Access granted")).toBeTruthy();
  });
  it("withholds permissions when the workspace service fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/navigation" ? response({ role: "owner", permissions: ["case.read"] }) : response({ error: "Unavailable" }, 503)));
    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText(/Workspace access could not be verified/);
    expect(screen.getByText("Access withheld")).toBeTruthy();
  });
  it("surfaces sign-out failure without an unhandled promise", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({}, 503)));
    auth.signOut.mockRejectedValue(new Error("offline"));
    render(<AuthProvider><Probe /></AuthProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Sign out did not complete"));
  });
});
