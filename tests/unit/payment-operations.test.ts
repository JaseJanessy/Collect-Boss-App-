import { describe, expect, it } from "vitest";
import { convertedMinorUnits, isBalancedJournal, receiptState, reconciliationBalances } from "@/lib/payment-operations/model";
import { allocationInputSchema, exchangeRateInputSchema, receiptInputSchema, reversalInputSchema } from "@/lib/payment-operations/validation";
import { roleHasPermission } from "@/lib/auth/permissions";

const roleSettings = {
  manager_can_approve_settlements: false,
  manager_can_approve_write_offs: false,
  manager_can_submit_document_intakes: false,
};

describe("payment receipt state projection", () => {
  it("represents every operational state explicitly", () => {
    expect(receiptState({ amountMinor: 10_000, allocatedMinor: 0, refundedMinor: 0, overpaymentMinor: 0, reversed: false })).toBe("unallocated");
    expect(receiptState({ amountMinor: 10_000, allocatedMinor: 4_000, refundedMinor: 0, overpaymentMinor: 0, reversed: false })).toBe("partially_allocated");
    expect(receiptState({ amountMinor: 10_000, allocatedMinor: 10_000, refundedMinor: 0, overpaymentMinor: 0, reversed: false })).toBe("fully_allocated");
    expect(receiptState({ amountMinor: 10_000, allocatedMinor: 10_000, refundedMinor: 0, overpaymentMinor: 500, reversed: false })).toBe("overpaid");
    expect(receiptState({ amountMinor: 10_000, allocatedMinor: 0, refundedMinor: 10_000, overpaymentMinor: 0, reversed: false })).toBe("refunded");
    expect(receiptState({ amountMinor: 10_000, allocatedMinor: 0, refundedMinor: 0, overpaymentMinor: 0, reversed: true })).toBe("reversed");
  });
});

describe("balanced immutable journals", () => {
  it("balances same-currency allocations", () => {
    expect(isBalancedJournal([
      { account: "unallocated_funds", side: "debit", amountMinor: 4_000, currency: "MYR" },
      { account: "accounts_receivable_control", side: "credit", amountMinor: 4_000, currency: "MYR" },
    ])).toBe(true);
  });

  it("balances both legs of a cross-currency allocation independently", () => {
    expect(isBalancedJournal([
      { account: "unallocated_funds", side: "debit", amountMinor: 10_000, currency: "USD" },
      { account: "fx_clearing", side: "credit", amountMinor: 10_000, currency: "USD" },
      { account: "fx_clearing", side: "debit", amountMinor: 47_000, currency: "MYR" },
      { account: "accounts_receivable_control", side: "credit", amountMinor: 47_000, currency: "MYR" },
    ])).toBe(true);
    expect(convertedMinorUnits(10_000, 47, 10)).toBe(47_000);
  });

  it("rejects unbalanced or invalid entries", () => {
    expect(isBalancedJournal([
      { account: "unallocated_funds", side: "debit", amountMinor: 4_000, currency: "MYR" },
      { account: "accounts_receivable_control", side: "credit", amountMinor: 3_999, currency: "MYR" },
    ])).toBe(false);
  });
});

describe("payment operation validation and approval permissions", () => {
  it("accepts partial and split allocations while rejecting invalid values", () => {
    expect(allocationInputSchema.safeParse({ allocations: [
      { caseId: "CB-1", receiptAmountMinor: 4_000, targetAmountMinor: 4_000 },
      { caseId: "CB-2", receiptAmountMinor: 6_000, targetAmountMinor: 6_000 },
    ] }).success).toBe(true);
    expect(allocationInputSchema.safeParse({ allocations: [{ caseId: "CB-1", receiptAmountMinor: 0, targetAmountMinor: 1 }] }).success).toBe(false);
  });

  it("requires explicit evidence-bearing cross-currency rates and reversal reasons", () => {
    expect(exchangeRateInputSchema.safeParse({ sourceCurrency: "usd", targetCurrency: "myr", numerator: 47, denominator: 10, effectiveAt: "2026-08-12T00:00:00Z", provider: "Bank", providerRecordId: "rate-1", evidence: { document: "fx-quote" } }).success).toBe(true);
    expect(exchangeRateInputSchema.safeParse({ sourceCurrency: "MYR", targetCurrency: "MYR", numerator: 1, denominator: 1, effectiveAt: "2026-08-12T00:00:00Z", provider: "Bank", providerRecordId: "rate-2" }).success).toBe(false);
    expect(reversalInputSchema.safeParse({ reason: "" }).success).toBe(false);
  });

  it("allows payment managers to allocate but reserves unusual reallocation approval for owner/admin", () => {
    expect(roleHasPermission("manager", "payment.approve", roleSettings)).toBe(true);
    expect(roleHasPermission("manager", "payment.reallocation.approve", roleSettings)).toBe(false);
    expect(roleHasPermission("admin", "payment.reallocation.approve", roleSettings)).toBe(true);
  });

  it("validates receipt currency and positive minor units", () => {
    expect(receiptInputSchema.safeParse({ receiptKind: "payment", amountMinor: 100, currency: "myr", receivedAt: "2026-08-12T00:00:00Z", sourceType: "manual", sourceSystem: "CollectBoss", sourceRecordId: "manual-1" }).success).toBe(true);
    expect(receiptInputSchema.safeParse({ receiptKind: "payment", amountMinor: -1, currency: "MYR", receivedAt: "2026-08-12T00:00:00Z", sourceType: "manual", sourceSystem: "CollectBoss", sourceRecordId: "manual-2" }).success).toBe(false);
  });
});

describe("reconciliation invariants", () => {
  it("reconciles imported, allocated, unallocated and refunded totals", () => {
    expect(reconciliationBalances({ currency: "MYR", importedTotal: 20_000, allocatedTotal: 10_000, unallocatedTotal: 3_000, refundedTotal: 5_000, reversedTotal: 2_000, integrationDifference: 2_000 })).toBe(true);
    expect(reconciliationBalances({ currency: "MYR", importedTotal: 20_000, allocatedTotal: 10_000, unallocatedTotal: 4_000, refundedTotal: 5_000, reversedTotal: 2_000, integrationDifference: 2_000 })).toBe(false);
  });
});
