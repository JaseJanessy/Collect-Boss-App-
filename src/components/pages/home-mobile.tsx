"use client";

import Link from "next/link";
import { ArrowRight, CalendarCheck, FilePlus2, RefreshCw, TriangleAlert } from "lucide-react";
import { ActionCentrePanel } from "@/components/action-centre/action-centre-panel";
import { AgingDonut } from "@/components/analytics/aging-donut";
import { ReceivablesPulse } from "@/components/analytics/receivables-pulse";
import { useReportSummary } from "@/hooks/use-report-summary";
import { formatCurrencyMinor } from "@/lib/financial/money";
import { useT } from "@/contexts/language-context";

function money(minor: number, currency: string) {
  return formatCurrencyMinor(minor, currency, { explicitCode: currency !== "MYR" });
}

export function HomeMobile() {
  const t = useT();
  const { metrics, loading, refresh } = useReportSummary();
  if (loading) return <div className="cb-analytics-light space-y-3 px-4 py-5"><div className="h-24 animate-pulse rounded-2xl bg-slate-200" /><div className="h-64 animate-pulse rounded-2xl bg-slate-200" /></div>;
  if (!metrics) return <div className="cb-analytics-light flex flex-col gap-4 bg-[#F6F8FC] px-4 pb-8 pt-5 text-slate-900"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">{t("dashboard.today")}</p><h1 className="mt-1 text-xl font-black text-[#0D1B3D]">{t("dashboard.title")}</h1></div><ActionCentrePanel compact /><div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p className="font-bold">{t("dashboard.totalsFailedTitle")}</p><p className="mt-1 text-xs">{t("dashboard.totalsFailedBody")}</p><button type="button" onClick={refresh} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#0D1B3D] px-3 py-2 text-xs font-bold text-white"><RefreshCw className="h-3.5 w-3.5" />{t("common.retry")}</button></div></div>;
  if (metrics.isMultiCurrency) return <div className="cb-analytics-light flex flex-col gap-4 bg-[#F6F8FC] px-4 pb-8 pt-5 text-slate-900"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">{t("dashboard.today")}</p><h1 className="mt-1 text-xl font-black text-[#0D1B3D]">{t("dashboard.title")}</h1><p className="text-[11px] text-slate-500">The five highest-priority items appear first.</p></div><ActionCentrePanel compact />{metrics.totalsByCurrency.map((group) => <section key={group.currency} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-black text-blue-700">{group.currency}</p><p className="mt-2 text-[10px] text-slate-500">Outstanding</p><p className="text-xl font-black text-[#0D1B3D]">{formatCurrencyMinor(group.totalOutstandingMinor, group.currency, { explicitCode: true })}</p><div className="mt-3 grid grid-cols-2 gap-2"><MoneyCard label="Recovered" value={formatCurrencyMinor(group.totalCollectedMinor, group.currency, { explicitCode: true })} detail={`${group.collectionRate}% rate`} positive /><MoneyCard label="Overdue" value={formatCurrencyMinor(group.overdueAmountMinor, group.currency, { explicitCode: true })} detail={`${group.topOverdue.length} shown`} risk={group.overdueAmountMinor > 0} /></div></section>)}</div>;
  const currency = metrics.currencies[0] ?? "MYR";

  return <div className="cb-analytics-light flex flex-col gap-4 bg-[#F6F8FC] px-4 pb-8 pt-5 text-slate-900">
    <div className="flex items-end justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">{t("dashboard.today")}</p><h1 className="mt-1 text-xl font-black text-[#0D1B3D]">{t("dashboard.moneyFirst")}</h1><p className="text-[11px] text-slate-500">As at {metrics.asOfDate}</p></div><Link href="/reports" className="inline-flex items-center gap-1 text-xs font-bold text-blue-700">Reports <ArrowRight className="h-3 w-3" /></Link></div>

    <ActionCentrePanel compact />

    <div className="grid grid-cols-2 gap-3" aria-label="Ledger position">
      <MoneyCard label="Outstanding" value={money(metrics.totalOutstandingMinor, currency)} detail={`${metrics.activeCases} active cases`} />
      <MoneyCard label="Recovered this month" value={money(metrics.recoveredThisMonthMinor, currency)} detail="Approved, net of reversals" positive />
      <MoneyCard label="Overdue" value={money(metrics.overdueAmountMinor, currency)} detail={`${metrics.overdueCases} cases`} risk={metrics.overdueAmountMinor > 0} />
      <MoneyCard label="Actions today" value={String(metrics.actionsToday)} detail="Due or carried forward" risk={metrics.actionsToday > 0} />
    </div>

    <details className="rounded-2xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer text-xs font-black text-[#0D1B3D]">Explore charts</summary><div className="mt-3 space-y-4"><ReceivablesPulse metrics={metrics} compact /><AgingDonut metrics={metrics} compact /></div></details>

    {(metrics.overdueAmountMinor > 0 || metrics.actionsToday > 0) && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><div className="flex items-center gap-2"><TriangleAlert className="h-4 w-4 text-amber-800" /><h2 className="text-sm font-bold text-amber-950">Important now</h2></div><div className="mt-3 space-y-2">{metrics.actionsToday > 0 && <Link href="/actions" className="flex items-center gap-3 rounded-xl bg-white p-3 text-xs font-bold text-slate-800"><CalendarCheck className="h-4 w-4 text-blue-700" /><span className="flex-1">Work {metrics.actionsToday} due action{metrics.actionsToday === 1 ? "" : "s"}</span><ArrowRight className="h-3.5 w-3.5" /></Link>}{metrics.overdueAmountMinor > 0 && <Link href="/cases" className="flex items-center gap-3 rounded-xl bg-white p-3 text-xs font-bold text-slate-800"><TriangleAlert className="h-4 w-4 text-red-700" /><span className="flex-1">Review {money(metrics.overdueAmountMinor, currency)} overdue</span><ArrowRight className="h-3.5 w-3.5" /></Link>}</div></section>}

    <div className="grid grid-cols-2 gap-2"><Link href="/add" className="flex items-center justify-center gap-2 rounded-xl bg-blue-700 px-3 py-3 text-xs font-bold text-white"><FilePlus2 className="h-4 w-4" />Add case</Link><Link href="/actions" className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-[#0D1B3D]"><CalendarCheck className="h-4 w-4" />Action centre</Link></div>
  </div>;
}

function MoneyCard({ label, value, detail, positive, risk }: { label: string; value: string; detail: string; positive?: boolean; risk?: boolean }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm"><p className="text-[10px] font-semibold text-slate-500">{label}</p><p className={`mt-1 text-lg font-black tracking-tight ${positive ? "text-emerald-700" : risk ? "text-red-700" : "text-[#0D1B3D]"}`}>{value}</p><p className="mt-1 text-[9px] text-slate-500">{detail}</p></div>;
}
