import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { checkPlanAction, planActionDenial } from "@/lib/billing/plan-enforcement";
import { FREE_ENTITLEMENT_MOCK } from "@/lib/billing/plans";
import type { AppSupabaseClient } from "@/lib/supabase/client";

type TableResult = { data?: unknown; count?: number | null; error?: { message: string } | null };

/** Minimal chainable stand-in for the Supabase query builder. */
function fakeClient(tables: Record<string, TableResult>) {
  const filters: Array<{ table: string; op: string; args: unknown[] }> = [];
  const client = {
    from(table: string) {
      const result = tables[table] ?? { data: null, error: null };
      const builder: Record<string, unknown> = {};
      for (const op of ["select", "eq", "is", "neq", "in"]) {
        builder[op] = (...args: unknown[]) => { filters.push({ table, op, args }); return builder; };
      }
      builder.maybeSingle = async () => ({ data: result.data ?? null, error: result.error ?? null });
      builder.then = (resolve: (value: unknown) => unknown) =>
        resolve({ data: result.data ?? null, count: result.count ?? null, error: result.error ?? null });
      return builder;
    },
  };
  return { client: client as unknown as AppSupabaseClient, filters };
}

const entitlement = (overrides: Partial<typeof FREE_ENTITLEMENT_MOCK>) => ({ ...FREE_ENTITLEMENT_MOCK, ...overrides });

describe("checkPlanAction", () => {
  it("refuses a new case at the active-case limit", async () => {
    const { client } = fakeClient({ entitlements: { data: entitlement({ case_limit: 10 }) }, cases: { count: 10 } });
    const result = await checkPlanAction(client, "biz-1", "create_case");
    expect(result).toMatchObject({ allowed: false, current: 10, limit: 10 });
  });

  it("allows a new case below the limit and counts only open, unarchived cases", async () => {
    const { client, filters } = fakeClient({ entitlements: { data: entitlement({ case_limit: 10 }) }, cases: { count: 9 } });
    const result = await checkPlanAction(client, "biz-1", "create_case");
    expect(result.allowed).toBe(true);
    expect(filters).toContainEqual({ table: "cases", op: "is", args: ["archived_at", null] });
    expect(filters).toContainEqual({ table: "cases", op: "neq", args: ["status", "closed"] });
  });

  it("treats -1 as unlimited without counting", async () => {
    const { client, filters } = fakeClient({ entitlements: { data: entitlement({ case_limit: -1 }) } });
    expect((await checkPlanAction(client, "biz-1", "create_case")).allowed).toBe(true);
    expect(filters.some((filter) => filter.table === "cases")).toBe(false);
  });

  it("uses Free plan limits when no entitlement row exists", async () => {
    const { client } = fakeClient({ entitlements: { data: null }, cases: { count: FREE_ENTITLEMENT_MOCK.case_limit } });
    expect((await checkPlanAction(client, "biz-1", "create_case")).allowed).toBe(false);
  });

  it("fails closed when entitlements cannot be read", async () => {
    const { client } = fakeClient({ entitlements: { error: { message: "down" } } });
    expect(await checkPlanAction(client, "biz-1", "use_formal_demand")).toMatchObject({ allowed: false, unavailable: true });
  });

  it("fails closed when the case count cannot be read", async () => {
    const { client } = fakeClient({ entitlements: { data: entitlement({ case_limit: 10 }) }, cases: { error: { message: "down" } } });
    expect(await checkPlanAction(client, "biz-1", "create_case")).toMatchObject({ allowed: false, unavailable: true });
  });

  it("gates feature flags on the entitlement", async () => {
    const locked = fakeClient({ entitlements: { data: entitlement({ formal_demand_enabled: false, lawyer_referral_enabled: false }) } }).client;
    const unlocked = fakeClient({ entitlements: { data: entitlement({ formal_demand_enabled: true, lawyer_referral_enabled: true }) } }).client;
    expect((await checkPlanAction(locked, "biz-1", "use_formal_demand")).allowed).toBe(false);
    expect((await checkPlanAction(locked, "biz-1", "use_lawyer_referral")).allowed).toBe(false);
    expect((await checkPlanAction(unlocked, "biz-1", "use_formal_demand")).allowed).toBe(true);
    expect((await checkPlanAction(unlocked, "biz-1", "use_lawyer_referral")).allowed).toBe(true);
  });
});

describe("planActionDenial", () => {
  it("returns null when allowed", async () => {
    const { client } = fakeClient({ entitlements: { data: entitlement({ formal_demand_enabled: true }) } });
    expect(await planActionDenial(client, "biz-1", "use_formal_demand")).toBeNull();
  });

  it("answers 403 PLAN_LIMIT_REACHED when the plan refuses", async () => {
    const { client } = fakeClient({ entitlements: { data: entitlement({ formal_demand_enabled: false }) } });
    const response = await planActionDenial(client, "biz-1", "use_formal_demand");
    expect(response?.status).toBe(403);
    expect(await response?.json()).toMatchObject({ code: "PLAN_LIMIT_REACHED" });
  });

  it("answers 503 PLAN_CHECK_UNAVAILABLE when the check cannot run", async () => {
    const { client } = fakeClient({ entitlements: { error: { message: "down" } } });
    const response = await planActionDenial(client, "biz-1", "create_case");
    expect(response?.status).toBe(503);
    expect(await response?.json()).toMatchObject({ code: "PLAN_CHECK_UNAVAILABLE" });
  });
});
