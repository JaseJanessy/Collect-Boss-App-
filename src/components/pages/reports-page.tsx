"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, FileText, RefreshCw, ShieldCheck } from "lucide-react";
import { AgingDonut } from "@/components/analytics/aging-donut";
import { ReceivablesPulse } from "@/components/analytics/receivables-pulse";
import { UpgradePrompt } from "@/components/billing/upgrade-prompt";
import { BusinessDataExportButton } from "@/components/exports/business-data-export-button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useEntitlements } from "@/hooks/use-entitlements";
import type { ReportMetrics } from "@/lib/reports/metrics";
import { loadReportsSummary, type ReportsSummaryPayload } from "@/lib/reports/client-service";
import { formatCalendarDate, formatMinorCurrency, formatDateTime } from "@/lib/international/formatting";
import type { RegionSettings } from "@/lib/international/types";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";

type ReportPayload = ReportsSummaryPayload;
function makeMoney(settings: RegionSettings, currency: string) {
  return (minor: number, _compact = false) => formatMinorCurrency(minor, settings, currency);
}
function pct(value: number | null) { return value === null ? "Not enough data" : `${value}%`; }

export function ReportsPage() {
  const { entitlement, loading: entitlementLoading, error: entitlementError } = useEntitlements();
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (entitlementLoading || !entitlement?.reports_enabled) return;
    let cancelled = false;
    loadReportsSummary().then((payload) => {
      if (!cancelled) setReport(payload);
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to load reports."); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entitlement?.reports_enabled, entitlementLoading, reload]);

  if (entitlementLoading) return <LoadingSpinner />;
  if (entitlementError) return <Alert tone="error" title="Plan access unavailable" action={<Button variant="outline" onClick={() => window.location.reload()}>Try again</Button>}>We could not verify your reporting access. No upgrade is required to retry this check.</Alert>;
  if (!entitlement?.reports_enabled) return <div className="cb-analytics-light flex max-w-4xl flex-col gap-6 pb-8"><div><h1 className="text-xl font-black text-[#0D1B3D]">Reports 2.0</h1><p className="mt-1 text-sm text-slate-500">Ledger-backed management analytics.</p></div><div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="mb-2 text-sm font-bold text-[#0D1B3D]">Your business data</p><BusinessDataExportButton /></div><UpgradePrompt feature="Reports & Analytics" reason="Reports are available on the Boss plan and above." description="View reconciled balances, aging and collection trends." planRequired="Boss" variant="page" /></div>;
  if (loading) return <LoadingSpinner />;
  if (error || !report) return <div className="cb-analytics-light"><Alert tone="error" title="Unable to load reports" action={<Button size="sm" variant="outline" onClick={() => { setLoading(true); setError(null); setReload((value) => value + 1); }}><RefreshCw />Retry</Button>}><p>{error ?? "The reporting summary is unavailable."}</p></Alert></div>;

  const { metrics } = report;
  if (metrics.isMultiCurrency) return <MultiCurrencyReports report={report} />;
  const money = makeMoney(report.region, metrics.currencies[0] ?? report.region.defaultCurrency);
  return <div className="cb-analytics-light mx-auto flex max-w-7xl flex-col gap-5 pb-10 text-slate-900">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">Reports 2.0</p><h1 className="mt-1 text-2xl font-black text-[#0D1B3D]">Receivables analytics</h1><p className="mt-1 text-sm text-slate-500">Generated {formatDateTime(report.generatedAt, report.region)} · reporting date {formatCalendarDate(metrics.asOfDate, report.region)} ({report.region.timezone})</p></div><div className="flex flex-wrap gap-2"><Link href="/statements" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700"><FileText className="h-3.5 w-3.5" />Statements</Link><a href="/api/reports/export" className="inline-flex items-center gap-1.5 rounded-xl bg-blue-700 px-3 py-2 text-xs font-bold text-white"><Download className="h-3.5 w-3.5" />CSV export</a><BusinessDataExportButton /></div></div>

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Kpi label="Outstanding" value={money(metrics.totalOutstandingMinor)} /><Kpi label="Recovered this month" value={money(metrics.recoveredThisMonthMinor)} tone="text-emerald-700" /><Kpi label="Overdue amount" value={money(metrics.overdueAmountMinor)} tone="text-red-700" /><Kpi label="Collection rate" value={`${metrics.collectionRate}%`} tone="text-blue-700" /></div>

    <ReportSection eyebrow="Outstanding Trend" title="Receivables Pulse" note="Current endpoint reconciles to Cases and Statements. Historical points are rebuilt from dated ledger events."><ReceivablesPulse metrics={metrics} /></ReportSection>

    <div className="grid gap-4 lg:grid-cols-2">
      <ReportSection eyebrow="Recovery Performance" title="Net recovery by month" note="Approved payments and opening credits less reversals; no forecast is included in actuals."><MonthlyBars metrics={metrics} money={money} /></ReportSection>
      <ReportSection eyebrow="Aging" title="Outstanding by age" note={`Consistent due-date buckets, calculated in ${report.region.timezone}.`}><AgingDonut metrics={metrics} /></ReportSection>
    </div>

    <ReportSection eyebrow="Top Customers" title="Largest outstanding customer balances" note="Customer names are grouped across active cases."><div className="cb-table-wrap mt-4" role="region" aria-label="Top customers" tabIndex={0}><table className="cb-table"><thead><tr><th>Customer</th><th>Cases</th><th>Overdue cases</th><th className="text-right">Outstanding</th></tr></thead><tbody>{metrics.topCustomers.map((item) => <tr key={item.debtorName}><td className="font-bold text-slate-800">{item.debtorName}</td><td>{item.caseCount}</td><td>{item.overdueCaseCount}</td><td className="text-right font-black text-[#0D1B3D]">{money(item.outstandingMinor)}</td></tr>)}{metrics.topCustomers.length === 0 && <EmptyRow columns={4} />}</tbody></table></div></ReportSection>

    <div className="grid gap-4 lg:grid-cols-2">
      <ReportSection eyebrow="Promise Performance" title="Promise outcomes" note="Kept rate uses decided promises only; pending promises are not counted as failures."><MetricGrid items={[{ label: "Recorded", value: metrics.promisePerformance.total }, { label: "Kept", value: metrics.promisePerformance.kept }, { label: "Missed", value: metrics.promisePerformance.missed }, { label: "Pending", value: metrics.promisePerformance.pending }, { label: "Kept rate", value: pct(metrics.promisePerformance.keptRate) }, { label: "Fulfilled", value: money(metrics.promisePerformance.fulfilledMinor) }]} /></ReportSection>
      <ReportSection eyebrow="Payment Plan Performance" title="Plan and installment outcomes" note="Installment performance uses recorded due status; cancelled installments are excluded."><MetricGrid items={[{ label: "Active plans", value: metrics.paymentPlanPerformance.activePlans }, { label: "Completed", value: metrics.paymentPlanPerformance.completedPlans }, { label: "Defaulted", value: metrics.paymentPlanPerformance.defaultedPlans }, { label: "Due installments", value: metrics.paymentPlanPerformance.dueInstallments }, { label: "Paid", value: metrics.paymentPlanPerformance.paidOnRecord }, { label: "Overdue", value: metrics.paymentPlanPerformance.overdueInstallments }, { label: "Scheduled", value: money(metrics.paymentPlanPerformance.scheduledMinor) }, { label: "Paid amount", value: money(metrics.paymentPlanPerformance.paidMinor) }]} /></ReportSection>
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <ReportSection eyebrow="Closure Outcomes" title="Why cases closed" note="Amounts show contractual position and approved recovery, grouped by recorded closure reason.">{metrics.closureOutcomes.length ? <div className="mt-4 divide-y divide-slate-100">{metrics.closureOutcomes.map((item) => <div key={item.reason} className="grid grid-cols-[1fr_auto] gap-3 py-3"><div><p className="text-sm font-bold text-slate-800">{item.reason}</p><p className="text-[11px] text-slate-500">{item.count} case{item.count === 1 ? "" : "s"}</p></div><div className="text-right"><p className="text-sm font-black text-[#0D1B3D]">{money(item.recoveredMinor)}</p><p className="text-[10px] text-slate-500">of {money(item.contractualMinor)}</p></div></div>)}</div> : <Empty text="No closed cases with recorded outcomes." />}</ReportSection>
      <ReportSection eyebrow="Fair Team Performance" title="Work completed in context" note="Shows assigned action workload and completion only. It does not rank staff by debt value or claim causation for payments.">{metrics.teamPerformance.length ? <div className="mt-4 space-y-3">{metrics.teamPerformance.map((item) => <div key={item.assignee} className="rounded-xl bg-slate-50 p-3"><div className="flex justify-between gap-3"><p className="text-sm font-bold text-slate-800">{item.assignee}</p><p className="text-sm font-black text-blue-700">{pct(item.completionRate)}</p></div><p className="mt-1 text-[11px] text-slate-500">{item.completed} completed · {item.open} open · {item.assigned} total assigned</p><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-blue-600" style={{ width: `${item.completionRate ?? 0}%` }} /></div></div>)}</div> : <Empty text="No assigned action history is available for a fair team view." />}</ReportSection>
    </div>

    <ReportSection eyebrow="Financial Controls" title="Non-cash balance changes" note="Excluded from recovered cash and collection-rate cash totals."><MetricGrid items={[{ label: "Credit notes", value: money(metrics.totalCreditNotesMinor) }, { label: "Other adjustments", value: money(metrics.totalAdjustmentsMinor) }, { label: "Write-offs", value: money(metrics.totalWriteOffsMinor) }, { label: "Settlement adjustments", value: money(metrics.totalSettlementAdjustmentsMinor) }]} /></ReportSection>

    <div className="flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[11px] text-emerald-900"><ShieldCheck className="h-4 w-4 shrink-0" />Reconciliation passed for {report.reconciliation.checkedCases} tenant-scoped cases; {report.reconciliation.driftedCases} drift detected. Summaries are aggregated on the server and cached per tenant for 15 seconds. Raw ledgers are never sent to this page.</div>
  </div>;
}

function ReportSection({ eyebrow, title, note, children }: { eyebrow: string; title: string; note: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-blue-700">{eyebrow}</p><h2 className="mt-1 text-base font-black text-[#0D1B3D]">{title}</h2><p className="mt-1 text-[11px] leading-relaxed text-slate-500">{note}</p>{children}</section>; }
function Kpi({ label, value, tone = "text-[#0D1B3D]" }: { label: string; value: string; tone?: string }) { return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-semibold text-slate-500">{label}</p><p className={`mt-1 text-xl font-black tracking-tight sm:text-2xl ${tone}`}>{value}</p></div>; }
function MetricGrid({ items }: { items: Array<{ label: string; value: string | number }> }) { return <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{items.map((item) => <div key={item.label} className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{item.label}</p><p className="mt-1 text-base font-black text-[#0D1B3D]">{item.value}</p></div>)}</div>; }
function Empty({ text }: { text: string }) { return <p className="mt-4 rounded-xl bg-slate-50 p-5 text-center text-xs text-slate-500">{text}</p>; }
function EmptyRow({ columns }: { columns: number }) { return <tr><td colSpan={columns} className="py-8 text-center text-xs text-slate-500">No outstanding customers.</td></tr>; }

function MonthlyBars({ metrics, money }: { metrics: ReportMetrics; money: (minor: number, compact?: boolean) => string }) {
  const values = metrics.monthlyCollections;
  const max = useMemo(() => Math.max(...values.map((item) => Math.abs(item.amountMinor)), 1), [values]);
  return <div className="mt-4 flex h-56 items-end gap-1.5" role="img" aria-label="Monthly net recovery over twelve months">{values.map((item) => <div key={item.month} className="flex min-w-0 flex-1 flex-col items-center gap-1"><span className="hidden text-[8px] font-bold text-slate-500 sm:block">{money(item.amountMinor, true)}</span><div className="flex h-40 w-full items-end"><div className={`w-full rounded-t ${item.amountMinor < 0 ? "bg-red-500" : "bg-blue-600"}`} style={{ height: `${Math.max(item.amountMinor ? 3 : 0, (Math.abs(item.amountMinor) / max) * 100)}%` }} title={`${item.month}: ${money(item.amountMinor)}`} /></div><span className="-rotate-45 whitespace-nowrap text-[8px] text-slate-500 sm:rotate-0">{item.month.slice(5)}</span></div>)}</div>;
}

function MultiCurrencyReports({ report }: { report: ReportPayload }) {
  const { metrics } = report;
  const money = (minor: number, currency: string) => formatMinorCurrency(minor, report.region, currency);
  return <div className="cb-analytics-light mx-auto flex max-w-7xl flex-col gap-5 pb-10 text-slate-900">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">Reports 2.0</p><h1 className="mt-1 text-2xl font-black text-[#0D1B3D]">Receivables analytics by currency</h1><p className="mt-1 text-sm text-slate-500">No FX conversion, cross-currency sum, or fabricated combined trend is shown.</p></div><div className="flex gap-2"><a href="/api/reports/export" className="inline-flex items-center gap-1.5 rounded-xl bg-blue-700 px-3 py-2 text-xs font-bold text-white"><Download className="h-3.5 w-3.5" />CSV export</a><BusinessDataExportButton /></div></div>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{metrics.totalsByCurrency.map((group) => <ReportSection key={group.currency} eyebrow={group.currency} title={money(group.totalOutstandingMinor, group.currency)} note="Current outstanding; reconciled to the tenant case projection."><MetricGrid items={[{ label: "Recovered this month", value: money(group.recoveredThisMonthMinor, group.currency) }, { label: "Overdue", value: money(group.overdueAmountMinor, group.currency) }, { label: "Collection rate", value: `${group.collectionRate}%` }, { label: "Overdue cases", value: group.topOverdue.length }]} /><div className="mt-4 space-y-2">{group.ageing.map((item) => <div key={item.label} className="flex justify-between rounded-lg bg-slate-50 p-2 text-[11px]"><span className="font-semibold text-slate-600">{item.label}</span><span className="font-bold text-[#0D1B3D]">{money(item.amountMinor, group.currency)} · {item.count}</span></div>)}</div></ReportSection>)}</div>
    <div className="grid gap-4 lg:grid-cols-2"><ReportSection eyebrow="Promise Performance" title="Currency-neutral outcomes" note="Outcome counts remain comparable; money is not combined across currencies."><MetricGrid items={[{ label: "Recorded", value: metrics.promisePerformance.total }, { label: "Kept", value: metrics.promisePerformance.kept }, { label: "Missed", value: metrics.promisePerformance.missed }, { label: "Kept rate", value: pct(metrics.promisePerformance.keptRate) }]} /></ReportSection><ReportSection eyebrow="Payment Plan Performance" title="Plan outcomes" note="Counts use recorded plan and installment statuses."><MetricGrid items={[{ label: "Active", value: metrics.paymentPlanPerformance.activePlans }, { label: "Completed", value: metrics.paymentPlanPerformance.completedPlans }, { label: "Defaulted", value: metrics.paymentPlanPerformance.defaultedPlans }, { label: "Overdue installments", value: metrics.paymentPlanPerformance.overdueInstallments }]} /></ReportSection></div>
    <ReportSection eyebrow="Fair Team Performance" title="Assigned work in context" note="Completion is based on assigned actions only; no payment value is attributed to a person.">{metrics.teamPerformance.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2">{metrics.teamPerformance.map((item) => <div key={item.assignee} className="rounded-xl bg-slate-50 p-3"><div className="flex justify-between"><span className="text-sm font-bold">{item.assignee}</span><span className="text-sm font-black text-blue-700">{pct(item.completionRate)}</span></div><p className="mt-1 text-[11px] text-slate-500">{item.completed} completed · {item.open} open · {item.assigned} assigned</p></div>)}</div> : <Empty text="No assigned action history is available." />}</ReportSection>
    <div className="flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[11px] text-emerald-900"><ShieldCheck className="h-4 w-4 shrink-0" />Reconciliation passed for {report.reconciliation.checkedCases} tenant-scoped cases. Server aggregation keeps raw ledgers off the client.</div>
  </div>;
}
