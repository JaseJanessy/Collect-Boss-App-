export type InstalmentProgressStatus = "scheduled" | "paid" | "partial" | "overdue";

export interface AllocationInstallment {
  id: string;
  dueDate: string;
  amountMinor: bigint;
}

export interface ApprovedPayment {
  id: string;
  amountMinor: bigint;
  createdAt: string;
  reviewStatus: "approved" | "reversed" | "pending";
}

export interface PaymentAllocation {
  installmentId: string;
  paymentId: string;
  amountMinor: bigint;
}

export interface InstalmentProgress extends AllocationInstallment {
  paidMinor: bigint;
  status: InstalmentProgressStatus;
}

function addCivilDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

/**
 * Mirrors the database's earliest-due-first projection. It never changes the
 * case balance: callers supply only approved, non-reversed ledger payments.
 */
export function allocateApprovedPayments(input: {
  installments: AllocationInstallment[];
  payments: ApprovedPayment[];
  asOfDate: string;
  graceDays?: number;
}): { allocations: PaymentAllocation[]; installments: InstalmentProgress[] } {
  const graceDays = input.graceDays ?? 0;
  if (!Number.isInteger(graceDays) || graceDays < 0) throw new Error("Grace days must be a non-negative integer.");

  const installments = input.installments
    .map((installment) => ({ ...installment, paidMinor: 0n, status: "scheduled" as InstalmentProgressStatus }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  const seenPaymentIds = new Set<string>();
  const payments = input.payments
    .filter((payment) => payment.reviewStatus === "approved" && payment.amountMinor > 0n && !seenPaymentIds.has(payment.id) && !!seenPaymentIds.add(payment.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const allocations: PaymentAllocation[] = [];

  for (const payment of payments) {
    let remaining = payment.amountMinor;
    for (const installment of installments) {
      if (remaining <= 0n) break;
      const unpaid = installment.amountMinor - installment.paidMinor;
      if (unpaid <= 0n) continue;
      const allocated = remaining < unpaid ? remaining : unpaid;
      allocations.push({ installmentId: installment.id, paymentId: payment.id, amountMinor: allocated });
      installment.paidMinor += allocated;
      remaining -= allocated;
    }
  }

  for (const installment of installments) {
    installment.status = installment.paidMinor >= installment.amountMinor
      ? "paid"
      : installment.paidMinor > 0n
        ? "partial"
        : addCivilDays(installment.dueDate, graceDays) < input.asOfDate
          ? "overdue"
          : "scheduled";
  }
  return { allocations, installments };
}
