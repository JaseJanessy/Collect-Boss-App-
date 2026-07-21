import "server-only";

import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import { calculateReportMetrics, type ReportCaseInput, type ReportEventInput } from "@/lib/reports/metrics";
import { calculateFinancialPosition, hasFinancialDrift } from "@/lib/financial/balance";

const PAGE_SIZE = 1_000;
const EXPORT_MAX_ROWS = 10_000;

export class ReportAccessError extends Error {}

export interface OwnerReportData {
  generatedAt: string;
  metrics: ReturnType<typeof calculateReportMetrics>;
  cases: ReportCaseInput[];
  reconciliation: { checkedCases: number; driftedCases: number };
}

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
export async function getOwnerReportData(input: { requireReportsEntitlement?: boolean } = {}): Promise<OwnerReportData> {
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) throw new ReportAccessError(auth.error);
  const { client, businessId } = auth;
  if (input.requireReportsEntitlement) {
    const { data: entitlement, error: entitlementError } = await client.from("entitlements").select("reports_enabled").eq("business_id", businessId).maybeSingle();
    if (entitlementError) throw new ReportAccessError(entitlementError.message);
    if (!(entitlement as { reports_enabled?: boolean } | null)?.reports_enabled) throw new ReportAccessError("Reports are not available on this plan.");
  }

  type RawCase = Record<string, unknown>;
  const rawCases = await loadAll<RawCase>(async (from, to) => {
    const result = await client.from("cases")
      .select("id, debtor_name, invoice_no, due_date, status, archived_at, original_principal_minor, contractual_due_minor, approved_payment_minor, outstanding_minor, overpayment_minor, created_at")
      .eq("business_id", businessId).order("id", { ascending: true }).range(from, to);
    return result as { data: RawCase[] | null; error: { message: string } | null };
  });
  const cases: ReportCaseInput[] = rawCases.map((item) => ({
    id: String(item.id), debtorName: String(item.debtor_name), invoiceNo: item.invoice_no ? String(item.invoice_no) : null,
    dueDate: String(item.due_date), status: String(item.status), archivedAt: item.archived_at ? String(item.archived_at) : null,
    contractualDueMinor: Number(item.contractual_due_minor), approvedPaymentMinor: Number(item.approved_payment_minor), outstandingMinor: Number(item.outstanding_minor), createdAt: String(item.created_at),
  }));
  if (cases.length === 0) return { generatedAt: new Date().toISOString(), metrics: calculateReportMetrics([], []), cases: [], reconciliation: { checkedCases: 0, driftedCases: 0 } };

  const caseIds = cases.map((item) => item.id);
  const events: ReportEventInput[] = [];
  const planCaseIds = new Set<string>();
  const legalCaseIds = new Set<string>();
  for (let index = 0; index < caseIds.length; index += 500) {
    const ids = caseIds.slice(index, index + 500);
    const [{ data: eventRows, error: eventError }, { data: plans, error: plansError }, { data: documents, error: documentsError }] = await Promise.all([
      client.from("case_financial_events").select("case_id, event_type, amount_minor, created_at").in("case_id", ids),
      client.from("payment_plans").select("case_id").in("case_id", ids).eq("status", "active"),
      client.from("legal_documents").select("case_id").in("case_id", ids).in("document_type", ["demand_standard", "demand_firm", "demand_final", "small_claim_pack"]).in("status", ["finalised", "sent"]),
    ]);
    if (eventError) throw new ReportAccessError(eventError.message);
    if (plansError) throw new ReportAccessError(plansError.message);
    if (documentsError) throw new ReportAccessError(documentsError.message);
    events.push(...(eventRows ?? []).map((item) => ({ caseId: String(item.case_id), type: item.event_type as ReportEventInput["type"], amountMinor: Number(item.amount_minor), createdAt: String(item.created_at) })));
    (plans ?? []).forEach((item) => planCaseIds.add(String(item.case_id)));
    (documents ?? []).forEach((item) => legalCaseIds.add(String(item.case_id)));
  }

  let driftedCases = 0;
  for (const item of rawCases) {
    const expected = calculateFinancialPosition(BigInt(String(item.original_principal_minor)), events
      .filter((event) => event.caseId === String(item.id))
      .map((event) => ({ type: event.type, amountMinor: BigInt(event.amountMinor) })));
    if (hasFinancialDrift(expected, {
      contractualDueMinor: BigInt(String(item.contractual_due_minor)),
      approvedPaymentMinor: BigInt(String(item.approved_payment_minor)),
      outstandingMinor: BigInt(String(item.outstanding_minor)),
      overpaymentMinor: BigInt(String(item.overpayment_minor)),
    })) driftedCases += 1;
  }
  if (driftedCases > 0) throw new ReportAccessError("Financial reconciliation detected stored-balance drift. Resolve the ledger discrepancy before generating a report.");

  const metrics = calculateReportMetrics(cases, events, { planCaseIds, legalCaseIds });
  return { generatedAt: new Date().toISOString(), metrics, cases, reconciliation: { checkedCases: cases.length, driftedCases } };
}

export async function getOwnerReportExport(): Promise<OwnerReportData> {
  const report = await getOwnerReportData({ requireReportsEntitlement: true });
  if (report.cases.length > EXPORT_MAX_ROWS) throw new ReportAccessError(`Export is limited to ${EXPORT_MAX_ROWS.toLocaleString("en-MY")} cases. Narrow the report period before exporting.`);
  return report;
}
