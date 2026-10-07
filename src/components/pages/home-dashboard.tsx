"use client";

import Link from "next/link";
import { ArrowRight, CalendarCheck, CircleDollarSign, Clock3, RefreshCw, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import { ActionCentrePanel } from "@/components/action-centre/action-centre-panel";
import { AgingDonut } from "@/components/analytics/aging-donut";
import { DailyActivityBars, ReceivablesPulse } from "@/components/analytics/receivables-pulse";
import { OnboardingChecklist } from "@/components/beta/onboarding-checklist";
import { useReportSummary } from "@/hooks/use-report-summary";
import { formatCurrencyMinor } from "@/lib/financial/money";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { useT } from "@/contexts/language-context";

function money(minor: number, currency: string) {
  return formatCurrencyMinor(minor, currency, { explicitCode: currency !== "MYR" });
}

export function HomeDashboard() {
  const t = useT();
  const { metrics, loading, refresh } = useReportSummary();
  if (loading) return <DashboardSkeleton />;
  if (!metrics) return <div className="cb-analytics-light mx-auto flex max-w-7xl flex-col gap-4 pb-10"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">Action dashboard</p><h1 className="mt-1 text-2xl font-black tracking-tight text-[#0D1B3D]">{t("dashboard.title")}</h1></div><ActionCentrePanel compact /><Alert tone="error" title={t("dashboard.totalsFailedTitle")} action={<Button size="sm" variant="outline" onClick={refresh}><RefreshCw />{t("common.retry")}</Button>}><p>{t("dashboard.totalsFailedBody")}</p></Alert></div>;
  if (metrics.isMultiCurrency) return <MultiCurrencyDashboard metrics={metrics} />;
  const currency = metrics.currencies[0] ?? "MYR";

  return <div className="cb-analytics-light mx-auto flex max-w-7xl flex-col gap-5 pb-10 text-slate-900">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">Action dashboard</p><h1 className="mt-1 text-2xl font-black tracking-tight text-[#0D1B3D]">{t("dashboard.title")}</h1><p className="mt-1 text-sm text-slate-500">Priority work first. Ledger-backed reporting follows below, as at {metrics.asOfDate}.</p></div>
      <Link href="/reports" className="inline-flex items-center gap-2 self-start rounded-xl border border-blue-200 bg-white px-4 py-2 text-xs font-bold text-blue-700 shadow-sm">Open Reports 2.0 <ArrowRight className="h-3.5 w-3.5" /></Link>
    </div>

    <ActionCentrePanel compact />

    <section aria-labelledby="ledger-position-heading">
      <div className="mb-3 flex items-center justify-between"><div><h2 id="ledger-position-heading" className="text-sm font-black text-[#0D1B3D]">Ledger position</h2><p className="text-[11px] text-slate-500">Authoritative reporting context; these figures do not change the priority order above.</p></div></div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Kpi label="Total Outstanding" value={money(metrics.totalOutstandingMinor ?? 0, currency)} detail={`${metrics.activeCases} active cases`} icon={<CircleDollarSign />} />
      <Kpi label="Recovered This Month" value={money(metrics.recoveredThisMonthMinor, currency)} detail="Approved payments less reversals" icon={<TrendingUp />} tone="positive" />
      <Kpi label="Overdue Amount" value={money(metrics.overdueAmountMinor, currency)} detail={`${metrics.overdueCases} overdue cases`} icon={<TriangleAlert />} tone={metrics.overdueAmountMinor ? "risk" : "neutral"} />
      <Kpi label="Actions Today" value={String(metrics.actionsToday)} detail="Due or carried forward" icon={<CalendarCheck />} tone={metrics.actionsToday ? "attention" : "neutral"} />
      </div>
    </section>

    <details className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <summary className="cursor-pointer text-sm font-black text-[#0D1B3D]">Explore trends and management analysis</summary>
      <p className="mt-1 text-[11px] text-slate-500">Charts are secondary because they do not identify the next case action.</p>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <ReceivablesPulse metrics={metrics} />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <AgingDonut metrics={metrics} />
          <BusinessRuleCard metrics={metrics} />
        </div>
      </div>
    </details>

    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
      <Panel title="Daily activity" subtitle="Green: approved money recovered. Orange: receivables newly overdue."><DailyActivityBars activity={metrics.dailyActivity} currency={currency} /></Panel>
      <Panel title="This month summary" subtitle="Computed from ledger and workflow records."><div className="mt-4 grid grid-cols-2 gap-3"><Summary label="Recovered" value={money(metrics.thisMonth.recoveredMinor, currency)} /><Summary label="New overdue" value={money(metrics.thisMonth.newOverdueMinor, currency)} /><Summary label="Promises kept" value={String(metrics.thisMonth.promisesKept)} /><Summary label="Promises missed" value={String(metrics.thisMonth.promisesMissed)} /><Summary label="Cases closed" value={String(metrics.thisMonth.casesClosed)} /></div></Panel>
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Top outstanding customers" subtitle="Grouped across active cases; no duplicate customer totals."><div className="mt-3 divide-y divide-slate-100">{metrics.topCustomers.slice(0, 5).map((item, index) => <div key={item.debtorName} className="flex items-center gap-3 py-3"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-[11px] font-black text-blue-700">{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-800">{item.debtorName}</p><p className="text-[11px] text-slate-500">{item.caseCount} case{item.caseCount === 1 ? "" : "s"} · {item.overdueCaseCount} overdue</p></div><p className="text-sm font-black text-[#0D1B3D]">{money(item.outstandingMinor, currency)}</p></div>)}{metrics.topCustomers.length === 0 && <Empty text="No outstanding customers." />}</div></Panel>
      <Panel title="Broken promises" subtitle="Missed promises are shown with recorded fulfilment, never inferred."><div className="mt-3 divide-y divide-slate-100">{metrics.brokenPromises.slice(0, 5).map((item) => <Link key={item.promiseId} href={`/cases/${item.caseId}?tab=timeline`} className="flex items-center gap-3 py-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-700"><Clock3 className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-800">{item.debtorName}</p><p className="text-[11px] text-slate-500">Due {item.promiseDate} · fulfilled {money(item.fulfilledMinor, currency)}</p></div><p className="text-sm font-black text-red-700">{money(item.promisedAmountMinor, currency)}</p></Link>)}{metrics.brokenPromises.length === 0 && <Empty text="No broken promises recorded." />}</div></Panel>
    </div>

    <OnboardingChecklist variant="dashboard" />
  </div>;
}

function MultiCurrencyDashboard({ metrics }: { metrics: NonNullable<ReturnType<typeof useReportSummary>["metrics"]> }) {
  const t = useT();
  return <div className="cb-analytics-light mx-auto flex max-w-7xl flex-col gap-5 pb-10 text-slate-900">
    <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">Action dashboard</p><h1 className="mt-1 text-2xl font-black tracking-tight text-[#0D1B3D]">{t("dashboard.title")}</h1><p className="mt-1 text-sm text-slate-500">Priority work first. Reporting is grouped by currency as at {metrics.asOfDate}; no FX conversion is applied.</p></div>
    <ActionCentrePanel compact />
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{metrics.totalsByCurrency.map((group) => <section key={group.currency} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-wider text-blue-700">{group.currency}</p><p className="mt-2 text-xs text-slate-500">Outstanding</p><p className="mt-1 text-2xl font-black text-[#0D1B3D]">{formatCurrencyMinor(group.totalOutstandingMinor, group.currency, { explicitCode: true })}</p><div className="mt-4 grid grid-cols-2 gap-2"><Summary label="Recovered" value={formatCurrencyMinor(group.totalCollectedMinor, group.currency, { explicitCode: true })} /><Summary label="Overdue" value={formatCurrencyMinor(group.overdueAmountMinor, group.currency, { explicitCode: true })} /><Summary label="This month" value={formatCurrencyMinor(group.recoveredThisMonthMinor, group.currency, { explicitCode: true })} /><Summary label="Collection rate" value={`${group.collectionRate}%`} /></div></section>)}</div>
    <div className="grid grid-cols-2 gap-3"><Kpi label="Active cases" value={String(metrics.activeCases)} detail="Across all currencies" icon={<CircleDollarSign />} /><Kpi label="Actions today" value={String(metrics.actionsToday)} detail="Currency-neutral workflow count" icon={<CalendarCheck />} tone={metrics.actionsToday ? "attention" : "neutral"} /></div>
    <OnboardingChecklist variant="dashboard" />
  </div>;
}

function Kpi({ label, value, detail, icon, tone = "neutral" }: { label: string; value: string; detail: string; icon: React.ReactNode; tone?: "neutral" | "positive" | "risk" | "attention" }) {
  const tones = { neutral: "bg-blue-50 text-blue-700", positive: "bg-emerald-50 text-emerald-700", risk: "bg-red-50 text-red-700", attention: "bg-amber-50 text-amber-800" };
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div className={`flex h-9 w-9 items-center justify-center rounded-xl ${tones[tone]} [&_svg]:h-4 [&_svg]:w-4`}>{icon}</div><p className="mt-4 text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-xl font-black tracking-tight text-[#0D1B3D] sm:text-2xl">{value}</p><p className="mt-1 text-[11px] text-slate-500">{detail}</p></div>;
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><h2 className="text-sm font-bold text-[#0D1B3D]">{title}</h2><p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p>{children}</section>; }
function Summary({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-base font-black text-[#0D1B3D]">{value}</p></div>; }
function Empty({ text }: { text: string }) { return <p className="py-6 text-center text-xs text-slate-500">{text}</p>; }

function BusinessRuleCard({ metrics }: { metrics: NonNullable<ReturnType<typeof useReportSummary>["metrics"]> }) {
  const currency = metrics.currencies[0] ?? "MYR";
  const momentum = metrics.recoveryMomentum;
  const Icon = momentum.state === "accelerating" ? TrendingUp : momentum.state === "slowing" ? TrendingDown : Clock3;
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Icon className="h-4 w-4" /></span><div><h2 className="text-sm font-bold text-[#0D1B3D]">Recovery Momentum</h2><p className="mt-1 text-xl font-black text-[#0D1B3D]">{momentum.label}</p></div></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><Summary label="Last 30 days" value={money(momentum.current30Minor, currency)} /><Summary label="Prior 30 days" value={money(momentum.previous30Minor, currency)} /></div><details className="mt-3"><summary className="cursor-pointer text-[11px] font-bold text-blue-700">How this is calculated</summary><p className="mt-1 text-[11px] leading-relaxed text-slate-500">{momentum.rule}</p></details>{metrics.forecast ? <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-blue-700">Projection · not a guarantee</p><p className="mt-1 text-sm font-black text-[#0D1B3D]">{money(metrics.forecast.lowMinor, currency)}–{money(metrics.forecast.highMinor, currency)}</p><p className="mt-1 text-[10px] text-slate-600">{metrics.forecast.basis}</p></div> : <p className="mt-3 rounded-xl bg-slate-50 p-3 text-[11px] text-slate-500">Projection hidden until at least 60 days and six recovery events are available.</p>}</section>;
}

function DashboardSkeleton() { return <div className="cb-analytics-light mx-auto max-w-7xl animate-pulse space-y-4"><div className="h-16 rounded-2xl bg-slate-200" /><div className="grid grid-cols-4 gap-3">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-36 rounded-2xl bg-slate-200" />)}</div><div className="h-96 rounded-2xl bg-slate-200" /></div>; }
