export type PocketDebtState = "draft" | "active" | "partially_paid" | "overdue" | "settled" | "cancelled" | "archived";

export interface PocketDebtProjectionInput {
  status: string;
  archivedAt: string | null;
  originalAmountMinor: number;
  adjustmentsMinor?: number;
  paidMinor: number;
  dueDate: string | null;
  today: string;
}

export function normalizePocketEmail(value?: string | null) {
  return value?.trim().toLowerCase() || null;
}

export function normalizePocketPhone(value?: string | null) {
  return value?.replace(/[^0-9]+/g, "") || null;
}

export function pocketCustomerDisplayName(customer: { individual_name?: string | null; business_name?: string | null }) {
  return customer.individual_name?.trim() || customer.business_name?.trim() || "Customer";
}

export function pocketDebtState(input: PocketDebtProjectionInput): PocketDebtState {
  if (input.archivedAt) return "archived";
  if (input.status === "void" || input.status === "written_off") return "cancelled";
  if (input.status === "draft") return "draft";
  const remaining = Math.max(0, input.originalAmountMinor + (input.adjustmentsMinor ?? 0) - input.paidMinor);
  if (remaining === 0 || input.status === "paid") return "settled";
  if (input.dueDate && input.dueDate < input.today) return "overdue";
  if (input.paidMinor > 0) return "partially_paid";
  return "active";
}

export function workspaceLocalDate(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function daysOverdue(dueDate: string | null, today: string) {
  if (!dueDate || dueDate >= today) return 0;
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  const current = Date.parse(`${today}T00:00:00Z`);
  return Math.max(0, Math.round((current - due) / 86_400_000));
}

export function pocketStatusLabel(status: PocketDebtState) {
  return status.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}
