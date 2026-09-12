import { describe, expect, it } from "vitest";
import { calculateDebtTruth, serializeDebtTruth, type DebtLedgerEventInput } from "@/lib/debt-truth/engine";

const event = (id: string, kind: DebtLedgerEventInput["kind"], amountMinor: bigint, approvalStatus: DebtLedgerEventInput["approvalStatus"] = "approved"): DebtLedgerEventInput => ({
  id, kind, amountMinor, approvalStatus, currency: "MYR", sourceTable: "fixture", sourceId: id,
  citations: [{ evidenceId: `evidence-${id}`, label: `Evidence ${id}`, locator: "page:1" }],
});

describe("Debt Truth Engine", () => {
  it("calculates every canonical component using integer minor units", () => {
    const balance = calculateDebtTruth("MYR", [
      event("opening", "original_principal", 10_000n),
      event("invoice", "invoice", 12_000n),
      event("debit", "adjustment_debit", 500n),
      event("credit-adjustment", "adjustment_credit", 200n),
      event("fee", "fee", 100n),
      event("credit-note", "credit_note", 400n),
      event("payment", "payment", 3_000n),
    ], [{ id: "dispute", amountMinor: 2_000n, currency: "MYR", status: "under_review" }]);

    expect(balance.originalPrincipalMinor).toBe(10_000n);
    expect(balance.invoicedAmountMinor).toBe(12_000n);
    expect(balance.approvedAdjustmentsMinor).toBe(300n);
    expect(balance.approvedFeesMinor).toBe(100n);
    expect(balance.creditNotesMinor).toBe(400n);
    expect(balance.confirmedPaymentsMinor).toBe(3_000n);
    expect(balance.disputedAmountMinor).toBe(2_000n);
    expect(balance.confirmedOutstandingMinor).toBe(7_000n);
    expect(balance.totalDisplayedExposureMinor).toBe(9_000n);
  });

  it("does not double-count legacy principal when approved invoices exist", () => {
    const result = calculateDebtTruth("MYR", [
      event("legacy", "original_principal", 10_000n),
      event("i-1", "invoice", 6_000n), event("i-2", "invoice", 4_000n),
    ]);
    expect(result.confirmedOutstandingMinor).toBe(10_000n);
  });

  it("never lets pending facts or payment claims change confirmed debt", () => {
    const result = calculateDebtTruth("MYR", [
      event("principal", "original_principal", 10_000n),
      event("pending-fee", "fee", 900n, "pending"),
      event("pending-payment", "payment", 4_000n, "pending"),
    ]);
    expect(result.confirmedOutstandingMinor).toBe(10_000n);
    expect(result.unverifiedAmountMinor).toBe(900n);
    expect(result.unverifiedCreditMinor).toBe(4_000n);
    expect(result.totalDisplayedExposureMinor).toBe(10_900n);
  });

  it("classifies disputes separately and caps them at actual exposure", () => {
    const result = calculateDebtTruth("MYR", [event("principal", "original_principal", 1_000n)], [
      { id: "d-1", amountMinor: 5_000n, currency: "MYR", status: "submitted" },
    ]);
    expect(result.disputedAmountMinor).toBe(1_000n);
    expect(result.confirmedOutstandingMinor).toBe(0n);
    expect(result.totalDisplayedExposureMinor).toBe(1_000n);
  });

  it("removes reversed facts without deleting their evidence trail", () => {
    const result = calculateDebtTruth("MYR", [
      event("principal", "original_principal", 10_000n),
      event("payment", "payment", 2_000n),
      { ...event("correction", "payment", 2_000n), reversesEventId: "payment" },
    ]);
    expect(result.confirmedPaymentsMinor).toBe(0n);
    expect(result.confirmedOutstandingMinor).toBe(10_000n);
  });

  it("produces the same fingerprint and result regardless of source ordering", () => {
    const source = [event("p", "original_principal", 10_000n), event("pay", "payment", 2_500n)];
    const first = calculateDebtTruth("MYR", source);
    const second = calculateDebtTruth("myr", [...source].reverse());
    expect(second.sourceFingerprint).toBe(first.sourceFingerprint);
    expect(serializeDebtTruth(second)).toEqual(serializeDebtTruth(first));
  });

  it("keeps all JSON money fields precision-safe strings", () => {
    const huge = 9_007_199_254_740_993n;
    const serialized = serializeDebtTruth(calculateDebtTruth("MYR", [event("huge", "original_principal", huge)]));
    expect(serialized.confirmedOutstandingMinor).toBe("9007199254740993");
    expect(JSON.stringify(serialized)).toContain("9007199254740993");
  });

  it("rejects mixed currencies, non-positive facts, excessive credits, and invalid dispute resolution", () => {
    expect(() => calculateDebtTruth("MYR", [{ ...event("usd", "invoice", 1n), currency: "USD" }])).toThrow(/mix currencies/);
    expect(() => calculateDebtTruth("MYR", [event("zero", "invoice", 0n)])).toThrow(/positive/);
    expect(() => calculateDebtTruth("MYR", [event("p", "original_principal", 10n), event("credit", "credit_note", 11n)])).toThrow(/below zero/);
    expect(() => calculateDebtTruth("MYR", [event("p", "original_principal", 10n)], [
      { id: "d", amountMinor: 5n, currency: "MYR", status: "partially_accepted", resolutionAmountMinor: 6n },
    ])).toThrow(/resolution amount/);
  });

  it("holds arithmetic invariants across a deterministic comprehensive sample", () => {
    let seed = 17n;
    const random = (max: bigint) => { seed = (seed * 48_271n) % 2_147_483_647n; return seed % max; };
    for (let index = 0; index < 500; index += 1) {
      const principal = random(10_000_000n) + 1n;
      const payment = random(principal + 2_000n);
      const dispute = random(principal + 1n);
      const result = calculateDebtTruth("MYR", [
        event(`p-${index}`, "original_principal", principal),
        ...(payment > 0n ? [event(`pay-${index}`, "payment", payment)] : []),
      ], dispute > 0n ? [{ id: `d-${index}`, amountMinor: dispute, currency: "MYR", status: "submitted" }] : []);
      expect(result.confirmedOutstandingMinor).toBeGreaterThanOrEqual(0n);
      expect(result.disputedAmountMinor).toBeGreaterThanOrEqual(0n);
      expect(result.totalDisplayedExposureMinor).toBe(result.confirmedOutstandingMinor + result.disputedAmountMinor + result.unverifiedAmountMinor);
      expect(result.confirmedOutstandingMinor + result.disputedAmountMinor).toBe(principal > payment ? principal - payment : 0n);
    }
  });
});
