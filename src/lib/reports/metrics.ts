import type { FinancialEventType } from "@/lib/financial/balance";
import { normalizeCurrencyCode } from "../financial/money.ts";
import type { FinancialAdjustmentType } from "@/lib/supabase/types";
import { brandTokens } from "../../../shared/brand-tokens.ts";

export const REPORT_TIME_ZONE = "Asia/Kuala_Lumpur";

export interface ReportCaseInput {
  id: string;
  debtorName: string;
  invoiceNo: string | null;
  dueDate: string;
  status: string;
  archivedAt: string | null;
  currency?: string;
  originalPrincipalMinor?: number | string;
  contractualDueMinor: number | string;
  approvedPaymentMinor: number | string;
  outstandingMinor: number | string;
  createdAt: string;
  closedAt?: string | null;
  closureReason?: string | null;
  assignedTo?: string | null;
}

export interface ReportEventInput {
  caseId: string;
  type: FinancialEventType;
  amountMinor: number | string;
  createdAt: string;
  currency?: string;
  adjustmentType?: FinancialAdjustmentType | null;
}

export interface ReportPromiseInput {
  id: string;
  caseId: string;
  promisedAmountMinor: number;
  amountFulfilledMinor: number;
  promiseDate: string;
  status: "pending" | "partially_fulfilled" | "fulfilled" | "missed" | "cancelled";
  createdAt: string;
  missedAt: string | null;
}

export interface ReportPlanInput {
  id: string;
  caseId: string;
  status: "pending_acceptance" | "active" | "defaulted" | "completed" | "cancelled";
  createdAt: string;
}

export interface ReportInstallmentInput {
  planId: string;
  amountMinor: number;
  paidMinor: number;
  dueDate: string;
  status: "scheduled" | "partial" | "paid" | "overdue" | "cancelled";
}

export interface ReportActionInput {
  id: string;
  caseId: string | null;
  assigneeId: string | null;
  status: "open" | "in_progress" | "snoozed" | "completed" | "dismissed";
  amountMinor: number;
  dueAt: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface CurrencyReportMetrics {
  currency: string;
  totalOutstandingMinor: number;
  totalCollectedMinor: number;
  totalContractualDueMinor: number;
  totalCreditNotesMinor: number;
  totalAdjustmentsMinor: number;
  totalWriteOffsMinor: number;
  totalSettlementAdjustmentsMinor: number;
  collectionRate: number;
  recoveredThisMonthMinor: number;
  overdueAmountMinor: number;
  ageing: Array<{ label: "Current" | "1-30" | "31-60" | "61-90" | "91+"; count: number; amountMinor: number }>;
  monthlyCollections: Array<{ month: string; amountMinor: number }>;
  topOverdue: Array<{ caseId: string; debtorName: string; invoiceNo: string | null; dueDate: string; daysOverdue: number; outstandingMinor: number; status: string; currency: string }>;
}

export interface ReportMetrics {
  asOfDate: string;
  currencies: string[];
  isMultiCurrency: boolean;
  totalsByCurrency: CurrencyReportMetrics[];
  /** Compatibility fields are zeroed and never rendered for multi-currency results. */
  totalOutstandingMinor: number;
  totalCollectedMinor: number;
  totalContractualDueMinor: number;
  totalCreditNotesMinor: number;
  totalAdjustmentsMinor: number;
  totalWriteOffsMinor: number;
  totalSettlementAdjustmentsMinor: number;
  collectionRate: number;
  activeCases: number;
  overdueCases: number;
  planCases: number;
  legalCases: number;
  ageing: CurrencyReportMetrics["ageing"];
  monthlyCollections: CurrencyReportMetrics["monthlyCollections"];
  topOverdue: CurrencyReportMetrics["topOverdue"];
  recoveredThisMonthMinor: number;
  overdueAmountMinor: number;
  actionsToday: number;
  agingDonut: Array<{ label: string; count: number; amountMinor: number; color: string }>;
  outstandingTrend: Array<{ date: string; outstandingMinor: number }>;
  pulseEvents: Array<{ date: string; type: "recovered" | "new_overdue" | "promise_missed" | "case_closed"; label: string; amountMinor: number }>;
  dailyActivity: Array<{ date: string; recoveredMinor: number; newOverdueMinor: number }>;
  thisMonth: { recoveredMinor: number; newOverdueMinor: number; promisesKept: number; promisesMissed: number; casesClosed: number };
  topCustomers: Array<{ debtorName: string; caseCount: number; overdueCaseCount: number; outstandingMinor: number }>;
  brokenPromises: Array<{ promiseId: string; caseId: string; debtorName: string; promiseDate: string; promisedAmountMinor: number; fulfilledMinor: number }>;
  recoveryMomentum: { state: "accelerating" | "slowing" | "steady" | "insufficient_data"; label: string; current30Minor: number; previous30Minor: number; rule: string };
  forecast: { lowMinor: number; highMinor: number; basis: string } | null;
  promisePerformance: { total: number; kept: number; missed: number; pending: number; keptRate: number | null; promisedMinor: number; fulfilledMinor: number };
  paymentPlanPerformance: { totalPlans: number; activePlans: number; completedPlans: number; defaultedPlans: number; dueInstallments: number; paidOnRecord: number; overdueInstallments: number; scheduledMinor: number; paidMinor: number };
  closureOutcomes: Array<{ reason: string; count: number; contractualMinor: number; recoveredMinor: number }>;
  teamPerformance: Array<{ assignee: string; assigned: number; completed: number; open: number; completionRate: number | null; representedMinor: number }>;
}

function minor(value: number | string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("Invalid financial minor-unit value.");
  return result;
}

function caseCurrency(item: ReportCaseInput): string {
  return normalizeCurrencyCode(item.currency ?? "MYR");
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

function monthKey(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(new Date(value));
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

function isoDateOffset(asOfDate: string, days: number): string {
  const date = new Date(`${asOfDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function eventBalanceEffect(event: ReportEventInput): number {
  const value = minor(event.amountMinor);
  return event.type === "adjustment_debit" || event.type === "payment_reversal" ? value : -value;
}

function calculateCurrencyMetrics(
  currency: string,
  cases: readonly ReportCaseInput[],
  events: readonly ReportEventInput[],
  asOfDate: string,
  timeZone: string,
): CurrencyReportMetrics {
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
    const key = monthKey(event.createdAt, timeZone);
    if (monthly.has(key)) monthly.set(key, monthly.get(key)! + (event.type === "payment_reversal" ? -minor(event.amountMinor) : minor(event.amountMinor)));
  }

  const totalOutstandingMinor = activeCases.reduce((sum, item) => sum + minor(item.outstandingMinor), 0);
  const totalCollectedMinor = cases.filter((item) => !item.archivedAt).reduce((sum, item) => sum + minor(item.approvedPaymentMinor), 0);
  const totalContractualDueMinor = cases.filter((item) => !item.archivedAt).reduce((sum, item) => sum + minor(item.contractualDueMinor), 0);
  const approvedAdjustments = events.filter((event) => event.type === "adjustment_credit" || event.type === "adjustment_debit");
  const adjustmentTotal = (predicate: (event: ReportEventInput) => boolean) => approvedAdjustments.filter(predicate).reduce((sum, event) => sum + minor(event.amountMinor), 0);
  const overdue = activeCases.filter((item) => dayDistance(item.dueDate, asOfDate) > 0);
  const currentMonth = asOfDate.slice(0, 7);
  const recoveredThisMonthMinor = events.filter((event) => monthKey(event.createdAt, timeZone) === currentMonth && (event.type === "payment_approved" || event.type === "payment_reversal"))
    .reduce((sum, event) => sum + (event.type === "payment_reversal" ? -minor(event.amountMinor) : minor(event.amountMinor)), 0);

  return {
    currency,
    totalOutstandingMinor,
    totalCollectedMinor,
    totalContractualDueMinor,
    totalCreditNotesMinor: adjustmentTotal((event) => event.adjustmentType === "credit_note"),
    totalAdjustmentsMinor: adjustmentTotal((event) => event.adjustmentType !== "credit_note" && event.adjustmentType !== "write_off" && event.adjustmentType !== "settlement_adjustment"),
    totalWriteOffsMinor: adjustmentTotal((event) => event.adjustmentType === "write_off"),
    totalSettlementAdjustmentsMinor: adjustmentTotal((event) => event.adjustmentType === "settlement_adjustment"),
    collectionRate: totalContractualDueMinor === 0 ? 0 : Math.round((totalCollectedMinor / totalContractualDueMinor) * 10_000) / 100,
    recoveredThisMonthMinor,
    overdueAmountMinor: overdue.reduce((sum, item) => sum + minor(item.outstandingMinor), 0),
    ageing: ageing.map((label) => buckets.get(label)!),
    monthlyCollections: [...monthly].map(([month, amountMinor]) => ({ month, amountMinor })),
    topOverdue: overdue.map((item) => ({
      caseId: item.id,
      debtorName: item.debtorName,
      invoiceNo: item.invoiceNo,
      dueDate: item.dueDate,
      daysOverdue: dayDistance(item.dueDate, asOfDate),
      outstandingMinor: minor(item.outstandingMinor),
      status: item.status,
      currency,
    })).sort((left, right) => right.outstandingMinor - left.outstandingMinor).slice(0, 10),
  };
}

/**
 * Canonical report definitions. Monetary totals are never combined across
 * currencies; events must reconcile to the authoritative currency of a case.
 */
export function calculateReportMetrics(
  cases: readonly ReportCaseInput[],
  events: readonly ReportEventInput[],
  input: {
    now?: Date;
    planCaseIds?: ReadonlySet<string>;
    legalCaseIds?: ReadonlySet<string>;
    promises?: readonly ReportPromiseInput[];
    plans?: readonly ReportPlanInput[];
    installments?: readonly ReportInstallmentInput[];
    actions?: readonly ReportActionInput[];
    currentUserId?: string | null;
    timeZone?: string;
  } = {},
): ReportMetrics {
  const timeZone = input.timeZone ?? REPORT_TIME_ZONE;
  const asOfDate = zonedDate(input.now ?? new Date(), timeZone);
  const currencyByCase = new Map(cases.map((item) => [item.id, caseCurrency(item)]));
  for (const event of events) {
    const expected = currencyByCase.get(event.caseId);
    if (!expected) continue;
    const actual = normalizeCurrencyCode(event.currency ?? expected);
    if (actual !== expected) throw new Error(`Financial event currency ${actual} does not match case ${event.caseId} currency ${expected}.`);
  }
  const currencies = [...new Set(cases.map(caseCurrency))].sort();
  const totalsByCurrency = currencies.map((currency) => calculateCurrencyMetrics(
    currency,
    cases.filter((item) => caseCurrency(item) === currency),
    events.filter((event) => currencyByCase.get(event.caseId) === currency),
    asOfDate,
    timeZone,
  ));
  const single = totalsByCurrency.length === 1 ? totalsByCurrency[0] : null;
  const activeCases = cases.filter((item) => !item.archivedAt && item.status !== "closed" && minor(item.outstandingMinor) > 0);
  const overdue = activeCases.filter((item) => dayDistance(item.dueDate, asOfDate) > 0);
  const legacyCases = single ? cases.filter((item) => caseCurrency(item) === single.currency) : [];
  const legacyEvents = single ? events.filter((event) => currencyByCase.get(event.caseId) === single.currency) : [];
  const dateWindow = Array.from({ length: 366 }, (_, index) => isoDateOffset(asOfDate, index - 365));
  const firstTrendDate = dateWindow[0]!;
  const eventsByCase = new Map<string, ReportEventInput[]>();
  legacyEvents.forEach((event) => eventsByCase.set(event.caseId, [...(eventsByCase.get(event.caseId) ?? []), event]));
  const trendDeltas = new Map<string, number>();
  let openingAtWindowStart = 0;
  for (const item of legacyCases) {
    const created = item.createdAt.slice(0, 10);
    const archived = item.archivedAt?.slice(0, 10) ?? null;
    const opening = minor(item.originalPrincipalMinor ?? item.contractualDueMinor);
    const caseEvents = eventsByCase.get(item.id) ?? [];
    if (created <= firstTrendDate && (!archived || archived > firstTrendDate)) {
      const movement = caseEvents.filter((event) => event.createdAt.slice(0, 10) <= firstTrendDate).reduce((sum, event) => sum + eventBalanceEffect(event), 0);
      openingAtWindowStart += Math.max(0, opening + movement);
    } else if (created > firstTrendDate && created <= asOfDate && (!archived || archived > created)) {
      trendDeltas.set(created, (trendDeltas.get(created) ?? 0) + opening);
    }
    for (const event of caseEvents) {
      const date = event.createdAt.slice(0, 10);
      if (date > firstTrendDate && date <= asOfDate && (!archived || date <= archived)) trendDeltas.set(date, (trendDeltas.get(date) ?? 0) + eventBalanceEffect(event));
    }
    if (archived && archived > firstTrendDate && archived <= asOfDate) {
      const balanceAtArchive = Math.max(0, opening + caseEvents.filter((event) => event.createdAt.slice(0, 10) <= archived).reduce((sum, event) => sum + eventBalanceEffect(event), 0));
      trendDeltas.set(archived, (trendDeltas.get(archived) ?? 0) - balanceAtArchive);
    }
  }
  let runningOutstanding = openingAtWindowStart;
  const outstandingTrend = dateWindow.map((date, index) => {
    if (index > 0) runningOutstanding = Math.max(0, runningOutstanding + (trendDeltas.get(date) ?? 0));
    return { date, outstandingMinor: runningOutstanding };
  });
  const recoveryByDate = new Map<string, number>();
  legacyEvents.filter((event) => event.type === "payment_approved" || event.type === "payment_reversal").forEach((event) => {
    const date = event.createdAt.slice(0, 10);
    recoveryByDate.set(date, (recoveryByDate.get(date) ?? 0) + (event.type === "payment_reversal" ? -minor(event.amountMinor) : minor(event.amountMinor)));
  });
  const overdueByDate = new Map<string, number>();
  legacyCases.forEach((item) => {
    const date = isoDateOffset(item.dueDate, 1);
    overdueByDate.set(date, (overdueByDate.get(date) ?? 0) + minor(item.outstandingMinor));
  });
  const dailyActivity = dateWindow.slice(-30).map((date) => ({ date, recoveredMinor: recoveryByDate.get(date) ?? 0, newOverdueMinor: overdueByDate.get(date) ?? 0 }));
  const firstOfMonth = `${asOfDate.slice(0, 7)}-01`;
  const promises = input.promises ?? [];
  const actionsToday = (input.actions ?? []).filter((item) => ["open", "in_progress"].includes(item.status) && !!item.dueAt && item.dueAt.slice(0, 10) <= asOfDate).length;
  const caseById = new Map(cases.map((item) => [item.id, item]));
  const topCustomersMap = new Map<string, { debtorName: string; caseCount: number; overdueCaseCount: number; outstandingMinor: number }>();
  for (const item of activeCases) {
    const existing = topCustomersMap.get(item.debtorName) ?? { debtorName: item.debtorName, caseCount: 0, overdueCaseCount: 0, outstandingMinor: 0 };
    existing.caseCount += 1;
    existing.overdueCaseCount += dayDistance(item.dueDate, asOfDate) > 0 ? 1 : 0;
    existing.outstandingMinor += single ? minor(item.outstandingMinor) : 0;
    topCustomersMap.set(item.debtorName, existing);
  }
  const topCustomers = single ? [...topCustomersMap.values()].sort((left, right) => right.outstandingMinor - left.outstandingMinor) : [];
  const brokenPromises = single ? promises.filter((promise) => promise.status === "missed").map((promise) => ({
    promiseId: promise.id,
    caseId: promise.caseId,
    debtorName: caseById.get(promise.caseId)?.debtorName ?? "Customer",
    promiseDate: promise.promiseDate,
    promisedAmountMinor: promise.promisedAmountMinor,
    fulfilledMinor: promise.amountFulfilledMinor,
  })) : [];
  const netRecovered = (from: string, to: string) => legacyEvents.filter((event) => event.createdAt.slice(0, 10) >= from && event.createdAt.slice(0, 10) <= to && (event.type === "payment_approved" || event.type === "payment_reversal"))
    .reduce((sum, event) => sum + (event.type === "payment_reversal" ? -minor(event.amountMinor) : minor(event.amountMinor)), 0);
  const current30Minor = netRecovered(isoDateOffset(asOfDate, -29), asOfDate);
  const previous30Minor = netRecovered(isoDateOffset(asOfDate, -59), isoDateOffset(asOfDate, -30));
  const momentumDelta = current30Minor - previous30Minor;
  const recoveryHistory = legacyEvents.filter((event) => event.type === "payment_approved").sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const hasSixtyDayHistory = recoveryHistory.length >= 4 && recoveryHistory[0]!.createdAt.slice(0, 10) <= isoDateOffset(asOfDate, -59);
  const momentumState = !hasSixtyDayHistory ? "insufficient_data" : momentumDelta > Math.max(previous30Minor * 0.1, 1) ? "accelerating" : momentumDelta < -Math.max(previous30Minor * 0.1, 1) ? "slowing" : "steady";
  const recoveryEvents60 = legacyEvents.filter((event) => event.type === "payment_approved" && event.createdAt.slice(0, 10) >= isoDateOffset(asOfDate, -59));
  const forecast = single && hasSixtyDayHistory && recoveryEvents60.length >= 6 && (single.totalOutstandingMinor > 0) ? {
    lowMinor: Math.min(single.totalOutstandingMinor, Math.max(0, Math.round(((current30Minor + previous30Minor) / 2) * 0.8))),
    highMinor: Math.min(single.totalOutstandingMinor, Math.max(0, Math.round(((current30Minor + previous30Minor) / 2) * 1.2))),
    basis: "Range based on approved net recoveries during the last 60 days; it is not an FX-adjusted forecast.",
  } : null;
  const pulseEvents: ReportMetrics["pulseEvents"] = single ? [
    ...legacyEvents.filter((event) => event.type === "payment_approved").map((event) => ({ date: event.createdAt.slice(0, 10), type: "recovered" as const, label: "Money recovered", amountMinor: minor(event.amountMinor) })),
    ...legacyCases.filter((item) => dayDistance(item.dueDate, asOfDate) > 0).map((item) => ({ date: isoDateOffset(item.dueDate, 1), type: "new_overdue" as const, label: "New overdue", amountMinor: minor(item.outstandingMinor) })),
    ...promises.filter((item) => item.status === "missed").map((item) => ({ date: (item.missedAt ?? item.promiseDate).slice(0, 10), type: "promise_missed" as const, label: "Promise missed", amountMinor: item.promisedAmountMinor - item.amountFulfilledMinor })),
    ...legacyCases.filter((item) => item.closedAt).map((item) => ({ date: item.closedAt!.slice(0, 10), type: "case_closed" as const, label: "Case closed", amountMinor: 0 })),
  ].filter((event) => event.date >= firstTrendDate && event.date <= asOfDate).sort((left, right) => right.amountMinor - left.amountMinor || right.date.localeCompare(left.date)).slice(0, 24).sort((left, right) => left.date.localeCompare(right.date)) : [];
  if (single && outstandingTrend.length) outstandingTrend[outstandingTrend.length - 1]!.outstandingMinor = single.totalOutstandingMinor;
  const agingColors = [brandTokens.chart.series3, brandTokens.chart.series4, brandTokens.status.highRisk, brandTokens.chart.series5];
  const agingDonut: ReportMetrics["agingDonut"] = single ? [
    { label: "0-30", count: (single.ageing[0]?.count ?? 0) + (single.ageing[1]?.count ?? 0), amountMinor: (single.ageing[0]?.amountMinor ?? 0) + (single.ageing[1]?.amountMinor ?? 0), color: agingColors[0]! },
    { label: "31-60", count: single.ageing[2]?.count ?? 0, amountMinor: single.ageing[2]?.amountMinor ?? 0, color: agingColors[1]! },
    { label: "61-90", count: single.ageing[3]?.count ?? 0, amountMinor: single.ageing[3]?.amountMinor ?? 0, color: agingColors[2]! },
    { label: "90+", count: single.ageing[4]?.count ?? 0, amountMinor: single.ageing[4]?.amountMinor ?? 0, color: agingColors[3]! },
  ] : [];
  const decidedPromises = promises.filter((item) => item.status === "fulfilled" || item.status === "missed");
  const keptPromises = promises.filter((item) => item.status === "fulfilled");
  const missedPromises = promises.filter((item) => item.status === "missed");
  const plans = input.plans ?? [];
  const installments = input.installments ?? [];
  const dueInstallments = installments.filter((item) => item.status !== "cancelled" && item.dueDate <= asOfDate);
  const closureMap = new Map<string, { reason: string; count: number; contractualMinor: number; recoveredMinor: number }>();
  cases.filter((item) => item.closedAt || item.status === "closed").forEach((item) => {
    const reason = item.closureReason ? item.closureReason.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Other / not recorded";
    const row = closureMap.get(reason) ?? { reason, count: 0, contractualMinor: 0, recoveredMinor: 0 };
    row.count += 1;
    if (single) { row.contractualMinor += minor(item.contractualDueMinor); row.recoveredMinor += minor(item.approvedPaymentMinor); }
    closureMap.set(reason, row);
  });
  const teamMap = new Map<string, ReportMetrics["teamPerformance"][number]>();
  const aliases = new Map<string, string>();
  (input.actions ?? []).filter((item) => item.assigneeId).forEach((item) => {
    const id = item.assigneeId!;
    if (!aliases.has(id)) aliases.set(id, id === input.currentUserId ? "You" : `Team member ${aliases.size + 1}`);
    const row = teamMap.get(id) ?? { assignee: aliases.get(id)!, assigned: 0, completed: 0, open: 0, completionRate: null, representedMinor: 0 };
    row.assigned += 1;
    if (item.status === "completed") row.completed += 1;
    if (["open", "in_progress", "snoozed"].includes(item.status)) row.open += 1;
    if (single) row.representedMinor += item.amountMinor;
    row.completionRate = Math.round((row.completed / row.assigned) * 100);
    teamMap.set(id, row);
  });
  return {
    asOfDate,
    currencies,
    isMultiCurrency: currencies.length > 1,
    totalsByCurrency,
    totalOutstandingMinor: single?.totalOutstandingMinor ?? 0,
    totalCollectedMinor: single?.totalCollectedMinor ?? 0,
    totalContractualDueMinor: single?.totalContractualDueMinor ?? 0,
    totalCreditNotesMinor: single?.totalCreditNotesMinor ?? 0,
    totalAdjustmentsMinor: single?.totalAdjustmentsMinor ?? 0,
    totalWriteOffsMinor: single?.totalWriteOffsMinor ?? 0,
    totalSettlementAdjustmentsMinor: single?.totalSettlementAdjustmentsMinor ?? 0,
    collectionRate: single?.collectionRate ?? 0,
    activeCases: activeCases.length,
    overdueCases: overdue.length,
    planCases: activeCases.filter((item) => input.planCaseIds?.has(item.id)).length,
    legalCases: activeCases.filter((item) => input.legalCaseIds?.has(item.id)).length,
    ageing: single?.ageing ?? [],
    monthlyCollections: single?.monthlyCollections ?? [],
    topOverdue: single?.topOverdue ?? [],
    recoveredThisMonthMinor: single?.recoveredThisMonthMinor ?? 0,
    overdueAmountMinor: single?.overdueAmountMinor ?? 0,
    actionsToday,
    agingDonut,
    outstandingTrend,
    pulseEvents,
    dailyActivity,
    thisMonth: {
      recoveredMinor: single?.recoveredThisMonthMinor ?? 0,
      newOverdueMinor: dailyActivity.filter((item) => item.date >= firstOfMonth).reduce((sum, item) => sum + item.newOverdueMinor, 0),
      promisesKept: promises.filter((item) => item.status === "fulfilled" && (item.missedAt ?? item.createdAt).slice(0, 10) >= firstOfMonth).length,
      promisesMissed: promises.filter((item) => item.status === "missed" && (item.missedAt ?? item.promiseDate).slice(0, 10) >= firstOfMonth).length,
      casesClosed: legacyCases.filter((item) => item.closedAt && item.closedAt.slice(0, 10) >= firstOfMonth).length,
    },
    topCustomers,
    brokenPromises,
    recoveryMomentum: {
      state: momentumState,
      label: momentumState === "accelerating" ? "Accelerating" : momentumState === "slowing" ? "Slowing" : momentumState === "steady" ? "Steady" : "Not enough history",
      current30Minor,
      previous30Minor,
      rule: "Compares approved payments less reversals in the latest 30 days with the preceding 30 days, within one currency only. A label requires at least four recovery events spanning 60 days; accelerating or slowing means a change greater than 10%.",
    },
    forecast,
    promisePerformance: {
      total: promises.length,
      kept: keptPromises.length,
      missed: missedPromises.length,
      pending: promises.filter((item) => item.status === "pending" || item.status === "partially_fulfilled").length,
      keptRate: decidedPromises.length ? Math.round((keptPromises.length / decidedPromises.length) * 100) : null,
      promisedMinor: single ? promises.reduce((sum, item) => sum + item.promisedAmountMinor, 0) : 0,
      fulfilledMinor: single ? promises.reduce((sum, item) => sum + item.amountFulfilledMinor, 0) : 0,
    },
    paymentPlanPerformance: {
      totalPlans: plans.length,
      activePlans: plans.filter((item) => item.status === "active").length,
      completedPlans: plans.filter((item) => item.status === "completed").length,
      defaultedPlans: plans.filter((item) => item.status === "defaulted").length,
      dueInstallments: dueInstallments.length,
      paidOnRecord: dueInstallments.filter((item) => item.status === "paid").length,
      overdueInstallments: dueInstallments.filter((item) => item.status === "overdue").length,
      scheduledMinor: single ? installments.filter((item) => item.status !== "cancelled").reduce((sum, item) => sum + item.amountMinor, 0) : 0,
      paidMinor: single ? installments.reduce((sum, item) => sum + item.paidMinor, 0) : 0,
    },
    closureOutcomes: [...closureMap.values()].sort((left, right) => right.count - left.count),
    teamPerformance: [...teamMap.values()].sort((left, right) => right.assigned - left.assigned),
  };
}

export function sanitizeCsvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  const protectedText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replaceAll('"', '""')}"`;
}
