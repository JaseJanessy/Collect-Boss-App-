import type { FinancialEventType } from "@/lib/financial/balance";

export const REPORT_TIME_ZONE = "Asia/Kuala_Lumpur";

export interface ReportCaseInput {
  id: string;
  debtorName: string;
  invoiceNo: string | null;
  dueDate: string;
  status: string;
  archivedAt: string | null;
  contractualDueMinor: number | string;
  approvedPaymentMinor: number | string;
  outstandingMinor: number | string;
  createdAt: string;
}

export interface ReportEventInput {
  caseId: string;
  type: FinancialEventType;
  amountMinor: number | string;
  createdAt: string;
}

export interface ReportMetrics {
  asOfDate: string;
  totalOutstandingMinor: number;
  totalCollectedMinor: number;
  totalContractualDueMinor: number;
  collectionRate: number;
  activeCases: number;
  overdueCases: number;
  planCases: number;
  legalCases: number;
  ageing: Array<{ label: "Current" | "1-30" | "31-60" | "61-90" | "91+"; count: number; amountMinor: number }>;
  monthlyCollections: Array<{ month: string; amountMinor: number }>;
  topOverdue: Array<{ caseId: string; debtorName: string; invoiceNo: string | null; dueDate: string; daysOverdue: number; outstandingMinor: number; status: string }>;
}

function minor(value: number | string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("Invalid financial minor-unit value.");
  return result;
}

function zonedDate(now: Date, timeZone = REPORT_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dayDistance(from: string, to: string): number {
  const fromMs = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const toMs = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return Math.floor((toMs - fromMs) / 86_400_000);
}

function monthKey(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: REPORT_TIME_ZONE, year: "numeric", month: "2-digit" }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}`;
}

function lastSixMonths(asOfDate: string): string[] {
  const [year, month] = asOfDate.split("-").map(Number);
  return Array.from({ length: 6 }, (_, offset) => {
    const date = new Date(Date.UTC(year, month - 1 - (5 - offset), 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/**
 * Canonical report definitions: balances come from the ledger-maintained
 * case projection, and collection activity comes from payment ledger events.
 */
export function calculateReportMetrics(
  cases: readonly ReportCaseInput[],
  events: readonly ReportEventInput[],
  input: { now?: Date; planCaseIds?: ReadonlySet<string>; legalCaseIds?: ReadonlySet<string> } = {},
): ReportMetrics {
  const asOfDate = zonedDate(input.now ?? new Date());
  const activeCases = cases.filter((item) => !item.archivedAt && item.status !== "closed" && minor(item.outstandingMinor) > 0);
  const ageing = ["Current", "1-30", "31-60", "61-90", "91+"] as const;
  const buckets = new Map(ageing.map((label) => [label, { label, count: 0, amountMinor: 0 }]));

  for (const item of activeCases) {
    const daysOverdue = Math.max(0, dayDistance(item.dueDate, asOfDate));
    const label = daysOverdue === 0 ? "Current" : daysOverdue <= 30 ? "1-30" : daysOverdue <= 60 ? "31-60" : daysOverdue <= 90 ? "61-90" : "91+";
    const bucket = buckets.get(label)!;
    bucket.count += 1;
    bucket.amountMinor += minor(item.outstandingMinor);
  }

  const monthly = new Map(lastSixMonths(asOfDate).map((key) => [key, 0]));
  for (const event of events) {
    if (event.type !== "payment_approved" && event.type !== "payment_reversal") continue;
    const key = monthKey(event.createdAt);
    if (!monthly.has(key)) continue;
    monthly.set(key, monthly.get(key)! + (event.type === "payment_reversal" ? -minor(event.amountMinor) : minor(event.amountMinor)));
  }

  const totalOutstandingMinor = activeCases.reduce((sum, item) => sum + minor(item.outstandingMinor), 0);
  const totalCollectedMinor = cases.filter((item) => !item.archivedAt).reduce((sum, item) => sum + minor(item.approvedPaymentMinor), 0);
  const totalContractualDueMinor = cases.filter((item) => !item.archivedAt).reduce((sum, item) => sum + minor(item.contractualDueMinor), 0);
  const overdue = activeCases.filter((item) => dayDistance(item.dueDate, asOfDate) > 0);

  return {
    asOfDate,
    totalOutstandingMinor,
    totalCollectedMinor,
    totalContractualDueMinor,
    collectionRate: totalContractualDueMinor === 0 ? 0 : Math.round((totalCollectedMinor / totalContractualDueMinor) * 10_000) / 100,
    activeCases: activeCases.length,
    overdueCases: overdue.length,
    planCases: activeCases.filter((item) => input.planCaseIds?.has(item.id)).length,
    legalCases: activeCases.filter((item) => input.legalCaseIds?.has(item.id)).length,
    ageing: ageing.map((label) => buckets.get(label)!),
    monthlyCollections: [...monthly].map(([month, amountMinor]) => ({ month, amountMinor })),
    topOverdue: overdue
      .map((item) => ({ caseId: item.id, debtorName: item.debtorName, invoiceNo: item.invoiceNo, dueDate: item.dueDate, daysOverdue: dayDistance(item.dueDate, asOfDate), outstandingMinor: minor(item.outstandingMinor), status: item.status }))
      .sort((left, right) => right.outstandingMinor - left.outstandingMinor)
      .slice(0, 10),
  };
}

export function sanitizeCsvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  const protectedText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replaceAll('"', '""')}"`;
}
