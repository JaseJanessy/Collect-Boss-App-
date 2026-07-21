import { describe, expect, it } from "vitest";
import { calculateFinancialPosition, deduplicateFinancialEvents } from "@/lib/financial/balance";

describe("financial critical invariants", () => {
  it("derives partial, full, and overpaid balances from approved events only", () => {
    expect(calculateFinancialPosition(10_000n, [{ type: "payment_approved", amountMinor: 2_500n }]).outstandingMinor).toBe(7_500n);
    expect(calculateFinancialPosition(10_000n, [{ type: "payment_approved", amountMinor: 10_000n }]).outstandingMinor).toBe(0n);

    const overpaid = calculateFinancialPosition(10_000n, [{ type: "payment_approved", amountMinor: 12_500n }]);
    expect(overpaid.outstandingMinor).toBe(0n);
    expect(overpaid.overpaymentMinor).toBe(2_500n);
  });

  it("removes duplicate concurrent approvals and applies a reversal exactly once", async () => {
    const sourceKey = "public_payment_submissions:submission-test:payment_approved";
    const deliveries = await Promise.all(
      Array.from({ length: 12 }, async () => ({ type: "payment_approved" as const, amountMinor: 4_000n, sourceKey })),
    );
    const events = deduplicateFinancialEvents([
      ...deliveries,
      { type: "payment_reversal", amountMinor: 1_500n, sourceKey: "payments:payment-test:payment_reversal" },
    ]);

    const position = calculateFinancialPosition(10_000n, events);
    expect(events).toHaveLength(2);
    expect(position.approvedPaymentMinor).toBe(2_500n);
    expect(position.outstandingMinor).toBe(7_500n);
  });
});
