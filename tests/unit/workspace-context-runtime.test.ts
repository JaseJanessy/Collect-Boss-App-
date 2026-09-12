import { beforeEach, describe, expect, it, vi } from "vitest";

const pocket = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/tenant-access", () => ({ requireTenantPermission: vi.fn() }));
vi.mock("@/lib/billing/pocket-entitlements", () => ({ loadPocketEntitlements: pocket.load }));
import { resolveWorkspaceContextForAccess } from "@/lib/workspace/context";
import { workspacePlanLabel } from "@/lib/workspace/presentation";

function access(product: string, failingTable?: string) {
  const records: Record<string, object> = {
    workspace_product_states: { product_type: product, lifecycle_state: "active" },
    subscriptions: { plan_slug: "pro", status: "past_due" },
    entitlements: { plan_slug: "free" },
  };
  return {
    businessId: "test-business", business: { business_name: "Test Company" }, user: { id: "test-user" },
    service: { from: (table: string) => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: records[table], error: table === failingTable ? { message: "Unavailable" } : null }) };
      return query;
    } },
  };
}

describe("workspace identity and product linkage", () => {
  beforeEach(() => { pocket.load.mockReset(); });
  it("shows Main's effective entitlements, not an overdue subscription's advertised tier", async () => {
    const result = await resolveWorkspaceContextForAccess(access("main") as never);
    expect(result).toMatchObject({ context: { workspace: { name: "Test Company", productType: "main" }, plan: { slug: "free" } } });
    expect(pocket.load).not.toHaveBeenCalled();
  });
  it("uses Pocket's commercial entitlement within the same business context", async () => {
    pocket.load.mockResolvedValue({ entitlements: { baseOffer: "pocket_annual", lifecycleState: "active" } });
    const input = access("pocket");
    expect(await resolveWorkspaceContextForAccess(input as never)).toMatchObject({ context: { workspace: { productType: "pocket" }, plan: { slug: "pocket_annual" } } });
    expect(pocket.load).toHaveBeenCalledWith(input);
  });
  it("does not invent a workspace plan when a required table fails", async () => {
    expect(await resolveWorkspaceContextForAccess(access("main", "workspace_product_states") as never)).toMatchObject({ status: 503, code: "WORKSPACE_CONTEXT_UNAVAILABLE" });
  });
  it("does not silently show Main's plan when Pocket entitlement lookup fails", async () => {
    pocket.load.mockResolvedValue({ error: "Pocket unavailable", status: 503 });
    expect(await resolveWorkspaceContextForAccess(access("pocket") as never)).toMatchObject({ status: 503 });
  });
  it("labels unknown or missing plans without inventing paid access", () => {
    expect(workspacePlanLabel(null)).toBe("Plan unavailable");
    expect(workspacePlanLabel("unknown")).toBe("Workspace plan");
    expect(workspacePlanLabel("pocket_monthly")).toBe("Pocket · Monthly");
    expect(workspacePlanLabel("free")).toBe("Free");
  });
});
