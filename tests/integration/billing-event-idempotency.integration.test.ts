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
      from(table: string) {
        if (table !== "billing_events") throw new Error("Unexpected table");
        const query = {
          insert: async () => {
            if (claimed) return { error: { code: "23505" } };
            claimed = true;
            return { error: null };
          },
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({ data: { processed }, error: null }),
        };
        return query;
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
    expect(claims.filter((claim) => claim === "retry")).toHaveLength(9);

    store.markProcessed();
    await expect(claimBillingEvent(event)).resolves.toBe("done");
  });

  it("returns a retryable failure when the event store cannot accept a claim", async () => {
    mocks.getServiceClient.mockResolvedValue({
      from: () => ({ insert: async () => ({ error: { code: "400" } }) }),
    });

    await expect(claimBillingEvent({ stripeEventId: "evt_unavailable", eventType: "invoice.payment_failed", stripeEventCreatedAt: 1 }))
      .rejects.toThrow("Unable to claim billing event");
  });
});
