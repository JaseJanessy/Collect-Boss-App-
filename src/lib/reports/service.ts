import "server-only";

import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import {
  calculateReportMetrics,
  type ReportActionInput,
  type ReportCaseInput,
  type ReportEventInput,
  type ReportInstallmentInput,
  type ReportPlanInput,
  type ReportPromiseInput,
} from "@/lib/reports/metrics";
import { calculateFinancialPosition, hasFinancialDrift } from "@/lib/financial/balance";
import { resolveRegionSettings } from "@/lib/international/registry";
import type { RegionSettings } from "@/lib/international/types";

const PAGE_SIZE = 1_000;
const EXPORT_MAX_ROWS = 10_000;
const SUMMARY_CACHE_TTL_MS = 15_000;

export class ReportAccessError extends Error {}

export interface OwnerReportData {
  generatedAt: string;
  region: RegionSettings;
  metrics: ReturnType<typeof calculateReportMetrics>;
  cases: ReportCaseInput[];
  reconciliation: { checkedCases: number; driftedCases: number };
}

const reportCache = new Map<string, { expiresAt: number; value: OwnerReportData }>();

async function loadAll<T>(fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new ReportAccessError(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

/** Loads complete owner-scoped report data. RLS and the explicit business filter both apply. */
export async function getOwnerReportData(input: { requireReportsEntitlement?: boolean; bypassCache?: boolean } = {}): Promise<OwnerReportData> {
  const auth = await getAuthenticatedBusiness("report.read");
  if ("error" in auth) throw new ReportAccessError(auth.error);
  const { client, businessId } = auth;
  const { data: regionRow, error: regionError } = await auth.service.from("businesses")
    .select("country_code, locale, timezone, default_currency, date_format, number_format, language_code")
    .eq("id", businessId).maybeSingle();
  if (regionError || !regionRow) throw new ReportAccessError("Unable to resolve business region settings.");
  const region = resolveRegionSettings(regionRow);
  if (input.requireReportsEntitlement) {
    const { data: entitlement, error: entitlementError } = await client.from("entitlements").select("reports_enabled").eq("business_id", businessId).maybeSingle();
    if (entitlementError) throw new ReportAccessError(entitlementError.message);
    if (!(entitlement as { reports_enabled?: boolean } | null)?.reports_enabled) throw new ReportAccessError("Reports are not available on this plan.");
  }

  const cacheKey = auth.businessId;
  const cached = reportCache.get(cacheKey);
  if (!input.bypassCache && cached && cached.expiresAt > Date.now()) return cached.value;

  type RawCase = Record<string, unknown>;
  const rawCases = await loadAll<RawCase>(async (from, to) => {
    const result = await client.from("cases")
      .select("id, debtor_name, invoice_no, due_date, status, archived_at, currency, original_principal_minor, contractual_due_minor, approved_payment_minor, outstanding_minor, overpayment_minor, created_at, closed_at, closure_reason_code, assigned_to")
      .eq("business_id", businessId).order("id", { ascending: true }).range(from, to);
    return result as { data: RawCase[] | null; error: { message: string } | null };
  });
  const cases: ReportCaseInput[] = rawCases.map((item) => ({
    id: String(item.id), debtorName: String(item.debtor_name), invoiceNo: item.invoice_no ? String(item.invoice_no) : null,
    dueDate: String(item.due_date), status: String(item.status), archivedAt: item.archived_at ? String(item.archived_at) : null,
    currency: String(item.currency ?? "MYR"),
    contractualDueMinor: Number(item.contractual_due_minor), approvedPaymentMinor: Number(item.approved_payment_minor), outstandingMinor: Number(item.outstanding_minor),
    originalPrincipalMinor: Number(item.original_principal_minor), createdAt: String(item.created_at),
    closedAt: item.closed_at ? String(item.closed_at) : null,
    closureReason: item.closure_reason_code ? String(item.closure_reason_code) : null,
    assignedTo: item.assigned_to ? String(item.assigned_to) : null,
  }));
  if (cases.length === 0) {
    const value: OwnerReportData = { generatedAt: new Date().toISOString(), region, metrics: calculateReportMetrics([], [], { timeZone: region.timezone }), cases: [], reconciliation: { checkedCases: 0, driftedCases: 0 } };
    reportCache.set(cacheKey, { expiresAt: Date.now() + SUMMARY_CACHE_TTL_MS, value });
    return value;
  }

  const caseIds = cases.map((item) => item.id);
  const events: ReportEventInput[] = [];
  const promises: ReportPromiseInput[] = [];
  const plans: ReportPlanInput[] = [];
  const installments: ReportInstallmentInput[] = [];
  const planCaseIds = new Set<string>();
  const legalCaseIds = new Set<string>();
  for (let index = 0; index < caseIds.length; index += 500) {
    const ids = caseIds.slice(index, index + 500);
    const [{ data: eventRows, error: eventError }, { data: planRows, error: plansError }, { data: documents, error: documentsError }, { data: promiseRows, error: promiseError }] = await Promise.all([
      client.from("case_financial_events").select("case_id, event_type, amount_minor, currency, source_table, source_id, created_at").in("case_id", ids),
      client.from("payment_plans").select("id, case_id, status, created_at").in("case_id", ids),
      client.from("legal_documents").select("case_id").in("case_id", ids).in("document_type", ["demand_standard", "demand_firm", "demand_final", "small_claim_pack"]).in("status", ["finalised", "sent"]),
      client.from("payment_promises").select("id, case_id, promised_amount_minor, amount_fulfilled_minor, promise_date, status, created_at, missed_at").eq("business_id", businessId).in("case_id", ids),
    ]);
    if (eventError) throw new ReportAccessError(eventError.message);
    if (plansError) throw new ReportAccessError(plansError.message);
    if (documentsError) throw new ReportAccessError(documentsError.message);
    if (promiseError) throw new ReportAccessError(promiseError.message);
    const adjustmentSourceIds = (eventRows ?? []).filter((item) =>
      item.source_table === "financial_adjustments").map((item) => String(item.source_id));
    const { data: adjustmentRows, error: adjustmentError } = adjustmentSourceIds.length
      ? await client.from("financial_adjustments").select("id, adjustment_type").in("id", adjustmentSourceIds)
      : { data: [], error: null };
    if (adjustmentError) throw new ReportAccessError(adjustmentError.message);
    const adjustmentTypes = new Map((adjustmentRows ?? []).map((item) =>
      [String(item.id), item.adjustment_type as NonNullable<ReportEventInput["adjustmentType"]>]));
    events.push(...(eventRows ?? []).map((item) => ({
      caseId: String(item.case_id), type: item.event_type as ReportEventInput["type"],
      amountMinor: Number(item.amount_minor), createdAt: String(item.created_at), currency: String(item.currency ?? "MYR"),
      adjustmentType: item.source_table === "financial_adjustments"
        ? adjustmentTypes.get(String(item.source_id)) ?? null : null,
    })));
    (planRows ?? []).forEach((item) => {
      plans.push({ id: String(item.id), caseId: String(item.case_id), status: item.status as ReportPlanInput["status"], createdAt: String(item.created_at) });
      if (item.status === "active") planCaseIds.add(String(item.case_id));
    });
    promises.push(...(promiseRows ?? []).map((item) => ({
      id: String(item.id), caseId: String(item.case_id), promisedAmountMinor: Number(item.promised_amount_minor),
      amountFulfilledMinor: Number(item.amount_fulfilled_minor), promiseDate: String(item.promise_date),
      status: item.status as ReportPromiseInput["status"], createdAt: String(item.created_at),
      missedAt: item.missed_at ? String(item.missed_at) : null,
    })));
    (documents ?? []).forEach((item) => legalCaseIds.add(String(item.case_id)));
  }

  for (let index = 0; index < plans.length; index += 500) {
    const planIds = plans.slice(index, index + 500).map((item) => item.id);
    const { data: rows, error } = await client.from("payment_plan_installments")
      .select("payment_plan_id, amount_minor, paid_minor, due_date, status").in("payment_plan_id", planIds);
    if (error) throw new ReportAccessError(error.message);
    installments.push(...(rows ?? []).map((item) => ({
      planId: String(item.payment_plan_id), amountMinor: Number(item.amount_minor), paidMinor: Number(item.paid_minor),
      dueDate: String(item.due_date), status: item.status as ReportInstallmentInput["status"],
    })));
  }

  const actions = await loadAll<ReportActionInput>(async (from, to) => {
    const { data, error } = await client.from("action_centre_items")
      .select("id, case_id, assignee_id, status, amount_minor, due_at, created_at, completed_at")
      .eq("business_id", businessId).order("id", { ascending: true }).range(from, to);
    return {
      data: (data ?? []).map((item) => ({
        id: String(item.id), caseId: item.case_id ? String(item.case_id) : null,
        assigneeId: item.assignee_id ? String(item.assignee_id) : null,
        status: item.status as ReportActionInput["status"], amountMinor: Number(item.amount_minor ?? 0),
        dueAt: item.due_at ? String(item.due_at) : null, createdAt: String(item.created_at),
        completedAt: item.completed_at ? String(item.completed_at) : null,
      })),
      error,
    };
  });

  const eventsByCase = new Map<string, ReportEventInput[]>();
  events.forEach((event) => eventsByCase.set(event.caseId, [...(eventsByCase.get(event.caseId) ?? []), event]));
  let driftedCases = 0;
  for (const item of rawCases) {
    const expected = calculateFinancialPosition(BigInt(String(item.original_principal_minor)), (eventsByCase.get(String(item.id)) ?? [])
      .map((event) => ({ type: event.type, amountMinor: BigInt(event.amountMinor) })));
    if (hasFinancialDrift(expected, {
      contractualDueMinor: BigInt(String(item.contractual_due_minor)),
      approvedPaymentMinor: BigInt(String(item.approved_payment_minor)),
      outstandingMinor: BigInt(String(item.outstanding_minor)),
      overpaymentMinor: BigInt(String(item.overpayment_minor)),
    })) driftedCases += 1;
  }
  if (driftedCases > 0) throw new ReportAccessError("Financial reconciliation detected stored-balance drift. Resolve the ledger discrepancy before generating a report.");

  const { data: { user } } = await client.auth.getUser();
  const metrics = calculateReportMetrics(cases, events, { planCaseIds, legalCaseIds, promises, plans, installments, actions, currentUserId: user?.id ?? null, timeZone: region.timezone });
  const value: OwnerReportData = { generatedAt: new Date().toISOString(), region, metrics, cases, reconciliation: { checkedCases: cases.length, driftedCases } };
  reportCache.set(cacheKey, { expiresAt: Date.now() + SUMMARY_CACHE_TTL_MS, value });
  return value;
}

export async function getOwnerReportExport(): Promise<OwnerReportData> {
  const access = await getAuthenticatedBusiness("export.run");
  if ("error" in access) throw new ReportAccessError(access.error);
  const report = await getOwnerReportData({ requireReportsEntitlement: true, bypassCache: true });
  if (report.cases.length > EXPORT_MAX_ROWS) throw new ReportAccessError(`Export is limited to ${EXPORT_MAX_ROWS.toLocaleString("en-MY")} cases. Narrow the report period before exporting.`);
  return report;
}
