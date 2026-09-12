export const paymentReceiptStates = [
  "unallocated", "partially_allocated", "fully_allocated", "overpaid", "refunded", "reversed",
] as const;

export type PaymentReceiptState = (typeof paymentReceiptStates)[number];

export interface ReceiptPositionInput {
  amountMinor: number;
  allocatedMinor: number;
  refundedMinor: number;
  overpaymentMinor: number;
  reversed: boolean;
}

export function receiptState(input: ReceiptPositionInput): PaymentReceiptState {
  if (input.reversed) return "reversed";
  if (input.refundedMinor === input.amountMinor) return "refunded";
  if (input.overpaymentMinor > 0) return "overpaid";
  if (input.allocatedMinor === 0) return "unallocated";
  if (input.allocatedMinor + input.refundedMinor < input.amountMinor) return "partially_allocated";
  return "fully_allocated";
}

export interface JournalEntry {
  account: string;
  side: "debit" | "credit";
  amountMinor: number;
  currency: string;
}

export function journalBalances(entries: JournalEntry[]) {
  const balances = new Map<string, number>();
  for (const entry of entries) {
    const signed = entry.side === "debit" ? entry.amountMinor : -entry.amountMinor;
    balances.set(entry.currency, (balances.get(entry.currency) ?? 0) + signed);
  }
  return balances;
}

export function isBalancedJournal(entries: JournalEntry[]) {
  return entries.length >= 2
    && entries.every((entry) => Number.isSafeInteger(entry.amountMinor) && entry.amountMinor > 0 && /^[A-Z]{3}$/u.test(entry.currency))
    && [...journalBalances(entries).values()].every((amount) => amount === 0);
}

export function convertedMinorUnits(amountMinor: number, numerator: number, denominator: number) {
  if (![amountMinor, numerator, denominator].every(Number.isSafeInteger) || amountMinor <= 0 || numerator <= 0 || denominator <= 0) {
    throw new Error("Positive integer amount and exchange-rate components are required.");
  }
  return Math.round((amountMinor * numerator) / denominator);
}

export interface ReconciliationRow {
  currency: string;
  importedTotal: number;
  allocatedTotal: number;
  unallocatedTotal: number;
  refundedTotal: number;
  reversedTotal: number;
  integrationDifference: number;
}

export function reconciliationBalances(row: ReconciliationRow) {
  return row.importedTotal === row.allocatedTotal + row.unallocatedTotal + row.refundedTotal + row.reversedTotal
    && row.integrationDifference >= 0
    && row.integrationDifference <= row.allocatedTotal;
}
