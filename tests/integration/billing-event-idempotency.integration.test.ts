import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getServiceClient: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service-client", () => ({ getServiceClient: mocks.getServiceClient }));

import { claimBillingEvent } from "@/lib/billing/service";

function inMemoryBillingEventStore() {
  let claimed = false;
  let processed = false;

  return {
    markProcessed: () => { processed = true; },
    client: {
      async rpc(name: string) {
        if (name !== "billing_claim_event") throw new Error("Unexpected RPC");
        if (processed) return { data: "done", error: null };
        if (claimed) return { data: "busy", error: null };
        claimed = true;
        return { data: "new", error: null };
      },
    },
  };
}

beforeEach(() => mocks.getServiceClient.mockReset());

describe("billing event idempotency boundary", () => {
  it("allows one concurrent claim, retries incomplete duplicates, and ignores completed duplicates", async () => {
    const store = inMemoryBillingEventStore();
    mocks.getServiceClient.mockResolvedValue(store.client);
    const event = { stripeEventId: "evt_contract", eventType: "customer.subscription.updated", stripeEventCreatedAt: 1 };

    const claims = await Promise.all(Array.from({ length: 10 }, () => claimBillingEvent(event)));
    expect(claims.filter((claim) => claim === "new")).toHaveLength(1);
    expect(claims.filter((claim) => claim === "busy")).toHaveLength(9);

    store.markProcessed();
    await expect(claimBillingEvent(event)).resolves.toBe("done");
  });

  it("returns a retryable failure when the event store cannot accept a claim", async () => {
    mocks.getServiceClient.mockResolvedValue({
      rpc: async () => ({ data: null, error: { code: "400" } }),
    });

    await expect(claimBillingEvent({ stripeEventId: "evt_unavailable", eventType: "invoice.payment_failed", stripeEventCreatedAt: 1 }))
      .rejects.toThrow("Unable to claim billing event");
  });
});
