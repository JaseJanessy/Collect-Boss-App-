import type { MinorUnits } from "./money";

export type FinancialEventType =
  | "opening_payment_credit"
  | "payment_approved"
  | "payment_reversal"
  | "adjustment_debit"
  | "adjustment_credit";

export interface FinancialEventInput {
  type: FinancialEventType;
  amountMinor: MinorUnits;
  sourceKey?: string;
}

export interface FinancialPosition {
  originalPrincipalMinor: MinorUnits;
  adjustmentDebitMinor: MinorUnits;
  adjustmentCreditMinor: MinorUnits;
  approvedPaymentMinor: MinorUnits;
  contractualDueMinor: MinorUnits;
  outstandingMinor: MinorUnits;
  overpaymentMinor: MinorUnits;
}

export function calculateFinancialPosition(
  originalPrincipalMinor: MinorUnits,
  events: readonly FinancialEventInput[],
): FinancialPosition {
  if (originalPrincipalMinor < 0n) throw new Error("Original principal cannot be negative.");

  let adjustmentDebitMinor = 0n;
  let adjustmentCreditMinor = 0n;
  let approvedPaymentMinor = 0n;

  for (const event of events) {
    if (event.amountMinor <= 0n) throw new Error("Financial event amount must be positive.");
    switch (event.type) {
      case "adjustment_debit": adjustmentDebitMinor += event.amountMinor; break;
      case "adjustment_credit": adjustmentCreditMinor += event.amountMinor; break;
      case "opening_payment_credit":
      case "payment_approved": approvedPaymentMinor += event.amountMinor; break;
      case "payment_reversal": approvedPaymentMinor -= event.amountMinor; break;
    }
  }

  const contractualDueMinor = originalPrincipalMinor + adjustmentDebitMinor - adjustmentCreditMinor;
  if (contractualDueMinor < 0n) throw new Error("Adjustments cannot reduce a debt below zero.");

  return {
    originalPrincipalMinor,
    adjustmentDebitMinor,
    adjustmentCreditMinor,
    approvedPaymentMinor,
    contractualDueMinor,
    outstandingMinor: contractualDueMinor > approvedPaymentMinor ? contractualDueMinor - approvedPaymentMinor : 0n,
    overpaymentMinor: approvedPaymentMinor > contractualDueMinor ? approvedPaymentMinor - contractualDueMinor : 0n,
  };
}

export function hasFinancialDrift(
  expected: Pick<FinancialPosition, "contractualDueMinor" | "approvedPaymentMinor" | "outstandingMinor" | "overpaymentMinor">,
  stored: Pick<FinancialPosition, "contractualDueMinor" | "approvedPaymentMinor" | "outstandingMinor" | "overpaymentMinor">,
): boolean {
  return expected.contractualDueMinor !== stored.contractualDueMinor ||
    expected.approvedPaymentMinor !== stored.approvedPaymentMinor ||
    expected.outstandingMinor !== stored.outstandingMinor ||
    expected.overpaymentMinor !== stored.overpaymentMinor;
}

/** Mirrors the database unique(source_table, source_id, event_type) invariant for tests and imports. */
export function deduplicateFinancialEvents(events: readonly FinancialEventInput[]): FinancialEventInput[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (!event.sourceKey) return true;
    if (seen.has(event.sourceKey)) return false;
    seen.add(event.sourceKey);
    return true;
  });
}
