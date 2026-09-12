import { describe, expect, it } from "vitest";
import { formatActionAge, queueForActionType } from "@/lib/action-centre/priority";

describe("action priority presentation mirror", () => {
  it.each([
    ["promise.missed", "promises"], ["review_payment_proof", "payment_proofs"],
    ["review_dispute", "disputes"], ["missing_evidence", "evidence"],
    ["approval_required", "approvals"], ["integration_failed", "integrations"],
    ["compliance_alert", "compliance"], ["payment_plan.missed", "payment_plans"],
    ["follow_up.due", "follow_ups"], ["unknown", "other"],
  ] as const)("maps %s to %s", (type, queue) => expect(queueForActionType(type)).toBe(queue));

  it("formats non-negative age without locale-dependent dates", () => {
    expect(formatActionAge(-5)).toBe("Just now");
    expect(formatActionAge(90)).toBe("1m");
    expect(formatActionAge(7_200)).toBe("2h");
    expect(formatActionAge(172_800)).toBe("2d");
  });
});
