import { describe, expect, it } from "vitest";
import {
  canTransitionCase,
  canTransitionClosure,
  canTransitionDispute,
  canTransitionPayment,
  canTransitionPromise,
  canTransitionSettlement,
  CASE_STATUS_METADATA,
} from "@/lib/domain/workflows";

describe("authoritative workflow transitions", () => {
  it("uses approved case labels without changing stored values", () => {
    expect(CASE_STATUS_METADATA.payment_promise.label).toBe("Promise to Pay");
    expect(CASE_STATUS_METADATA.formal_demand_ready.label).toBe("Formal Demand Ready");
  });

  it("rejects terminal and direct-closure case transitions", () => {
    expect(canTransitionCase("overdue", "payment_promise")).toBe(true);
    expect(canTransitionCase("paid", "overdue")).toBe(false);
    expect(canTransitionCase("closed", "action_needed")).toBe(false);
    expect(canTransitionCase("paid", "closed")).toBe(false);
  });

  it("rejects impossible payment, promise and dispute transitions", () => {
    expect(canTransitionPayment("pending_review", "approved")).toBe(true);
    expect(canTransitionPayment("rejected", "approved")).toBe(false);
    expect(canTransitionPromise("fulfilled", "cancelled")).toBe(false);
    expect(canTransitionDispute("accepted", "under_review")).toBe(false);
    expect(canTransitionDispute("information_requested", "under_review")).toBe(true);
  });

  it("models settlement and closure as derived workflows, not stored enum renames", () => {
    expect(canTransitionSettlement("draft", "ready")).toBe(true);
    expect(canTransitionSettlement("recorded", "ready")).toBe(false);
    expect(canTransitionClosure("eligible", "closed")).toBe(true);
    expect(canTransitionClosure("archived", "open")).toBe(false);
  });
});
