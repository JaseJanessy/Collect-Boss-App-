import type { CaseRow, RecoveryCaseScope } from "../supabase/types.ts";
import { databaseAmountToMinor } from "../financial/money.ts";

const scopes = new Set<RecoveryCaseScope>([
  "standalone",
  "single_obligation",
  "multiple_obligations",
  "account_balance",
]);

type EnhancedCaseFields =
  | "account_id"
  | "case_scope"
  | "original_principal_minor"
  | "contractual_due_minor"
  | "approved_payment_minor"
  | "outstanding_minor"
  | "overpayment_minor";

export type LegacyCompatibleCaseRow =
  Omit<CaseRow, EnhancedCaseFields>
  & Partial<Pick<CaseRow, EnhancedCaseFields>>;

function safeMinor(value: unknown) {
  const numeric = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof numeric === "number" && Number.isSafeInteger(numeric) && numeric >= 0
    ? numeric
    : null;
}

function decimalToMinor(value: unknown, field: string, currency: string) {
  let minor: number;
  try {
    minor = Number(databaseAmountToMinor(value as string | number | null | undefined, currency));
  } catch {
    minor = Number.NaN;
  }
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new Error(`Legacy case ${field} is not a valid non-negative amount.`);
  }
  return minor;
}

/**
 * Normalizes a pre-receivables case row for existing routes.
 *
 * Modern ledger values always win. Decimal legacy columns are consulted only
 * when an enhanced field is absent, and this function never writes data.
 */
export function normalizeLegacyCaseRow(input: LegacyCompatibleCaseRow): CaseRow {
  const currency = input.currency ?? "MYR";
  const originalPrincipalMinor =
    safeMinor(input.original_principal_minor)
    ?? decimalToMinor(input.amount_owed, "amount_owed", currency);
  const contractualDueMinor =
    safeMinor(input.contractual_due_minor)
    ?? decimalToMinor(input.amount_owed, "amount_owed", currency);
  const approvedPaymentMinor =
    safeMinor(input.approved_payment_minor)
    ?? decimalToMinor(input.amount_paid, "amount_paid", currency);
  const outstandingMinor =
    safeMinor(input.outstanding_minor)
    ?? Math.max(contractualDueMinor - approvedPaymentMinor, 0);
  const overpaymentMinor =
    safeMinor(input.overpayment_minor)
    ?? Math.max(approvedPaymentMinor - contractualDueMinor, 0);
  const scope = scopes.has(input.case_scope as RecoveryCaseScope)
    ? input.case_scope as RecoveryCaseScope
    : "standalone";

  return {
    ...input,
    currency,
    account_id: input.account_id ?? null,
    case_scope: scope,
    original_principal_minor: originalPrincipalMinor,
    contractual_due_minor: contractualDueMinor,
    approved_payment_minor: approvedPaymentMinor,
    outstanding_minor: outstandingMinor,
    overpayment_minor: overpaymentMinor,
  };
}
