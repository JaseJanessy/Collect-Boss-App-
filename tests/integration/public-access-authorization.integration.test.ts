import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getServiceClient: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service-client", () => ({ getServiceClient: mocks.getServiceClient }));

import { getOwnedCaseScope, getPublicActionContext } from "@/lib/public-access/service";

type QueryResult = { data: unknown; error: null | { message: string } };
type QueryResponder = (table: string, filters: Record<string, unknown>) => QueryResult;

const tenantA = "00000000-0000-4000-8000-0000000000a1";
const tenantB = "00000000-0000-4000-8000-0000000000b2";
const businessA = "00000000-0000-4000-8000-0000000000c3";
const caseA = "00000000-0000-4000-8000-0000000000d4";
const rawToken = "a".repeat(43);

function mockClient(responder: QueryResponder) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (field: string, value: unknown) => {
          filters[field] = value;
          return query;
        },
        maybeSingle: async () => responder(table, filters),
      };
      return query;
    },
  };
}

function token(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "token-test",
    purpose: "payment",
    case_id: caseA,
    payment_plan_id: null,
    payment_access_request_id: null,
    receiving_account_id: "account-test",
    expires_at: "2099-01-01T00:00:00.000Z",
    revoked_at: null,
    consumed_at: null,
    ...overrides,
  };
}

beforeEach(() => mocks.getServiceClient.mockReset());

describe("public access authorization boundary", () => {
  it("accepts only a valid, in-scope token", async () => {
    mocks.getServiceClient.mockResolvedValue(mockClient((table) => {
      if (table === "public_access_tokens") return { data: token(), error: null };
      if (table === "cases") return { data: { id: caseA, business_id: businessA, status: "action_needed", archived_at: null, outstanding_minor: 10_000 }, error: null };
      return { data: null, error: null };
    }));

    await expect(getPublicActionContext(rawToken, "payment")).resolves.toMatchObject({
      state: "valid",
      caseScope: { id: caseA, business_id: businessA },
    });
  });

  it("rejects expired, revoked, and wrong-purpose capabilities before resource use", async () => {
    for (const row of [
      token({ expires_at: "2000-01-01T00:00:00.000Z" }),
      token({ revoked_at: "2026-01-01T00:00:00.000Z" }),
      token({ purpose: "acknowledgement" }),
    ]) {
      mocks.getServiceClient.mockResolvedValue(mockClient((table) => ({ data: table === "public_access_tokens" ? row : null, error: null })));
      const result = await getPublicActionContext(rawToken, "payment");
      expect(result.state).not.toBe("valid");
    }
  });

  it("denies cross-tenant owner access to the same case identifier", async () => {
    mocks.getServiceClient.mockResolvedValue(mockClient((table, filters) => {
      if (table === "cases") return { data: { id: caseA, business_id: businessA }, error: null };
      if (table === "businesses") {
        return { data: filters.owner_id === tenantA ? { id: businessA } : null, error: null };
      }
      return { data: null, error: null };
    }));

    await expect(getOwnedCaseScope(caseA, tenantA)).resolves.toMatchObject({ id: caseA, business_id: businessA });
    await expect(getOwnedCaseScope(caseA, tenantB)).resolves.toBeNull();
  });
});
