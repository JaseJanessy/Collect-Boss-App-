import type { FinancialEventType } from "@/lib/financial/balance";
import type { FinancialAdjustmentType } from "@/lib/supabase/types";

export interface StatementRange {
  from: Date;
  toExclusive: Date;
  label: string;
}

export interface StatementCaseInput {
  id: string;
  debtorId: string | null;
  customerName: string;
  customerCompany: string | null;
  invoiceNo: string | null;
  originalPrincipalMinor: number | string;
  createdAt: string;
  status: string;
  dueDate: string;
}

export interface StatementEventInput {
  id: string;
  caseId: string;
  type: FinancialEventType;
  amountMinor: number | string;
  createdAt: string;
  adjustmentType?: FinancialAdjustmentType | null;
}

export type StatementTransactionCategory =
  | "obligation" | "payment" | "credit" | "adjustment" | "write_off" | "settlement" | "reversal";

export interface StatementTransaction {
  id: string;
  occurredAt: string;
  caseReference: string;
  customerName: string;
  customerCompany: string | null;
  invoiceNo: string | null;
  category: StatementTransactionCategory;
  label: string;
  amountMinor: number;
  balanceEffectMinor: number;
}

export interface StatementAccount {
  caseReference: string;
  invoiceNo: string | null;
  customerName: string;
  customerCompany: string | null;
  status: string;
  dueDate: string;
  openingBalanceMinor: number;
  movementMinor: number;
  closingBalanceMinor: number;
}

export interface StatementLedger {
  openingBalanceMinor: number;
  periodDebitsMinor: number;
  periodPaymentsMinor: number;
  periodCreditsMinor: number;
  periodAdjustmentsMinor: number;
  periodWriteOffsMinor: number;
  periodSettlementsMinor: number;
  periodReversalsMinor: number;
  movementMinor: number;
  closingBalanceMinor: number;
  totalOutstandingMinor: number;
  transactions: StatementTransaction[];
  accounts: StatementAccount[];
}

function safeMinor(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Invalid statement minor-unit value.");
  return parsed;
}

function effect(type: FinancialEventType, amountMinor: number): number {
  if (type === "adjustment_debit" || type === "payment_reversal") return amountMinor;
  return -amountMinor;
}

function eventPresentation(event: StatementEventInput): Pick<StatementTransaction, "category" | "label"> {
  if (event.adjustmentType === "credit_note") return { category: "credit", label: "Credit note" };
  if (event.adjustmentType === "settlement_adjustment") return { category: "settlement", label: "Settlement adjustment" };
  if (event.adjustmentType === "write_off") return { category: "write_off", label: "Write-off" };
  if (event.adjustmentType === "manual_correction") return { category: "adjustment", label: "Manual correction" };
  if (event.adjustmentType === "returned_goods") return { category: "credit", label: "Returned goods credit" };
  if (event.adjustmentType === "commercial_discount") return { category: "credit", label: "Discount / commercial adjustment" };
  if (event.adjustmentType === "other") return { category: "adjustment", label: "Other adjustment" };
  switch (event.type) {
    case "payment_approved": return { category: "payment", label: "Approved payment" };
    case "opening_payment_credit": return { category: "credit", label: "Opening payment credit" };
    case "payment_reversal": return { category: "reversal", label: "Payment reversal" };
    case "adjustment_debit": return { category: "adjustment", label: "Debit adjustment" };
    case "adjustment_credit": return { category: "credit", label: "Credit adjustment" };
  }
}

function before(value: string, boundary: Date): boolean {
  return new Date(value).getTime() < boundary.getTime();
}

function inRange(value: string, range: StatementRange): boolean {
  const timestamp = new Date(value).getTime();
  return timestamp >= range.from.getTime() && timestamp < range.toExclusive.getTime();
}

/**
 * Historical statement projection built only from the existing case principal
 * and financial-event ledger. Signed movement is always opening-to-closing.
 */
export function calculateStatementLedger(
  cases: readonly StatementCaseInput[],
  events: readonly StatementEventInput[],
  range: StatementRange,
): StatementLedger {
  const eventsByCase = new Map<string, StatementEventInput[]>();
  for (const event of events) {
    const list = eventsByCase.get(event.caseId) ?? [];
    list.push(event);
    eventsByCase.set(event.caseId, list);
  }

  const transactions: StatementTransaction[] = [];
  const accounts: StatementAccount[] = [];
  let openingBalanceMinor = 0;
  let periodDebitsMinor = 0;
  let periodPaymentsMinor = 0;
  let periodCreditsMinor = 0;
  let periodAdjustmentsMinor = 0;
  let periodWriteOffsMinor = 0;
  let periodSettlementsMinor = 0;
  let periodReversalsMinor = 0;

  for (const item of cases) {
    const principal = safeMinor(item.originalPrincipalMinor);
    const caseEvents = eventsByCase.get(item.id) ?? [];
    let accountOpening = before(item.createdAt, range.from) ? principal : 0;
    let accountMovement = 0;

    if (inRange(item.createdAt, range)) {
      accountMovement += principal;
      periodDebitsMinor += principal;
      transactions.push({
        id: `obligation:${item.id}`,
        occurredAt: item.createdAt,
        caseReference: item.id,
        customerName: item.customerName,
        customerCompany: item.customerCompany,
        invoiceNo: item.invoiceNo,
        category: "obligation",
        label: item.invoiceNo ? "Invoice / obligation" : "Opening obligation",
        amountMinor: principal,
        balanceEffectMinor: principal,
      });
    }

    for (const event of caseEvents) {
      const amount = safeMinor(event.amountMinor);
      const balanceEffect = effect(event.type, amount);
      if (before(event.createdAt, range.from)) accountOpening += balanceEffect;
      if (!inRange(event.createdAt, range)) continue;

      accountMovement += balanceEffect;
      if (event.type === "payment_approved") periodPaymentsMinor += amount;
      else if (event.type === "payment_reversal") periodReversalsMinor += amount;
      else if (event.type === "opening_payment_credit") periodCreditsMinor += amount;
      else if (event.adjustmentType === "write_off") periodWriteOffsMinor += amount;
      else if (event.adjustmentType === "settlement_adjustment") periodSettlementsMinor += amount;
      else {
        periodAdjustmentsMinor += amount;
        if (event.type === "adjustment_debit") periodDebitsMinor += amount;
        else periodCreditsMinor += amount;
      }

      transactions.push({
        id: event.id,
        occurredAt: event.createdAt,
        caseReference: item.id,
        customerName: item.customerName,
        customerCompany: item.customerCompany,
        invoiceNo: item.invoiceNo,
        ...eventPresentation(event),
        amountMinor: amount,
        balanceEffectMinor: balanceEffect,
      });
    }

    const accountClosing = accountOpening + accountMovement;
    if (before(item.createdAt, range.toExclusive)) {
      openingBalanceMinor += accountOpening;
      accounts.push({
        caseReference: item.id,
        invoiceNo: item.invoiceNo,
        customerName: item.customerName,
        customerCompany: item.customerCompany,
        status: item.status,
        dueDate: item.dueDate,
        openingBalanceMinor: accountOpening,
        movementMinor: accountMovement,
        closingBalanceMinor: accountClosing,
      });
    }
  }

  transactions.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
  accounts.sort((left, right) => left.caseReference.localeCompare(right.caseReference));
  const movementMinor = transactions.reduce((sum, transaction) => sum + transaction.balanceEffectMinor, 0);
  const closingBalanceMinor = openingBalanceMinor + movementMinor;

  return {
    openingBalanceMinor,
    periodDebitsMinor,
    periodPaymentsMinor,
    periodCreditsMinor,
    periodAdjustmentsMinor,
    periodWriteOffsMinor,
    periodSettlementsMinor,
    periodReversalsMinor,
    movementMinor,
    closingBalanceMinor,
    totalOutstandingMinor: accounts.reduce((sum, account) => sum + Math.max(0, account.closingBalanceMinor), 0),
    transactions,
    accounts,
  };
}
