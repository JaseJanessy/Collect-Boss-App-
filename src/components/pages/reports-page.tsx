"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, BarChart2, Download, FileText, RefreshCw } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SectionCard } from "@/components/ui/section-card";
import { UpgradePrompt } from "@/components/billing/upgrade-prompt";
import { useEntitlements } from "@/hooks/use-entitlements";
import type { ReportMetrics } from "@/lib/reports/metrics";

type ReportPayload = { generatedAt: string; metrics: ReportMetrics; reconciliation: { checkedCases: number; driftedCases: number }; error?: string };

function money(minor: number) {
  return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(minor / 100);
}

function monthLabel(month: string) {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-MY", { month: "short", timeZone: "UTC" });
}

export function ReportsPage() {
  const { entitlement, loading: entitlementLoading } = useEntitlements();
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const maxMonthly = useMemo(() => Math.max(...(report?.metrics.monthlyCollections.map((item) => Math.abs(item.amountMinor)) ?? [0]), 1), [report]);

  useEffect(() => {
    if (entitlementLoading || !entitlement?.reports_enabled) return;
    let cancelled = false;
    async function load() {
      setLoading(true); setError(null);
      try {
        const response = await fetch("/api/reports/summary", { cache: "no-store" });
        const payload = await response.json() as ReportPayload;
        if (!response.ok) throw new Error(payload.error ?? "Unable to load reports.");
        if (!cancelled) setReport(payload);
      } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to load reports."); }
      finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [entitlement?.reports_enabled, entitlementLoading, reload]);

  if (entitlementLoading) return <LoadingSpinner />;
  if (!entitlement?.reports_enabled) return <div className="flex max-w-4xl flex-col gap-6 pb-8"><div><h1 className="text-xl font-black text-[#0D1B3D]">Reports &amp; Analytics</h1><p className="mt-0.5 text-sm text-gray-500">Collection performance for your business.</p></div><UpgradePrompt feature="Reports & Analytics" reason="Full reports and exports are available on the Boss plan and above." description="View ledger-backed balances, ageing, collection trends, and secure exports." planRequired="Boss" variant="page" /></div>;
  if (loading) return <LoadingSpinner />;
  if (error || !report) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700"><div className="flex gap-2"><AlertCircle className="h-4 w-4 shrink-0" />{error ?? "Unable to load reports."}</div><button type="button" onClick={() => setReload((value) => value + 1)} className="mt-3 inline-flex items-center gap-1 text-sm font-bold underline"><RefreshCw className="h-3.5 w-3.5" />Retry</button></div>;

  const { metrics } = report;
  return <div className="flex max-w-5xl flex-col gap-6 pb-8">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h1 className="text-xl font-black text-[#0D1B3D]">Reports &amp; Analytics</h1><p className="mt-0.5 text-sm text-gray-500">Ledger-backed collection position as at {metrics.asOfDate} (Malaysia time).</p></div><div className="flex gap-2"><Link href="/statements" className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700"><FileText className="h-3.5 w-3.5" />Statement PDF</Link><a href="/api/reports/export" className="inline-flex items-center gap-1.5 rounded-xl bg-[#009966] px-3 py-2 text-xs font-bold text-white"><Download className="h-3.5 w-3.5" />CSV export</a></div></div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Kpi label="Outstanding" value={money(metrics.totalOutstandingMinor)} /><Kpi label="Collected" value={money(metrics.totalCollectedMinor)} color="text-emerald-600" /><Kpi label="Collection rate" value={`${metrics.collectionRate}%`} color="text-[#009966]" /><Kpi label="Overdue cases" value={String(metrics.overdueCases)} color="text-red-600" /></div>
    <SectionCard title="Case portfolio"><div className="grid grid-cols-2 gap-3 pt-3 md:grid-cols-4"><Metric label="Active cases" value={metrics.activeCases} /><Metric label="Overdue" value={metrics.overdueCases} /><Metric label="On active plan" value={metrics.planCases} /><Metric label="Legal progression" value={metrics.legalCases} /></div></SectionCard>
    <div className="grid gap-4 lg:grid-cols-2"><SectionCard title="Ageing by outstanding balance"><p className="mb-3 mt-1 text-[11px] text-gray-400">Due-date ageing is calculated in Asia/Kuala_Lumpur.</p><div className="flex flex-col gap-3">{metrics.ageing.map((item) => <div key={item.label}><div className="flex justify-between text-xs"><span className="font-semibold text-gray-700">{item.label} days</span><span className="font-bold text-gray-800">{money(item.amountMinor)} · {item.count}</span></div><div className="mt-1 h-2 rounded-full bg-gray-100"><div className="h-2 rounded-full bg-amber-500" style={{ width: `${metrics.totalOutstandingMinor ? Math.round((item.amountMinor / metrics.totalOutstandingMinor) * 100) : 0}%` }} /></div></div>)}</div></SectionCard>
      <SectionCard title="Monthly net collections"><p className="mb-3 mt-1 text-[11px] text-gray-400">Approved payments less reversals; last six calendar months.</p><div className="flex h-36 items-end gap-2">{metrics.monthlyCollections.map((item) => <div key={item.month} className="flex flex-1 flex-col items-center gap-1"><span className="text-[9px] font-bold text-gray-500">{money(item.amountMinor).replace("MYR", "")}</span><div className="flex h-24 w-full items-end"><div className={`w-full rounded-t ${item.amountMinor < 0 ? "bg-red-400" : "bg-[#009966]"}`} style={{ height: `${Math.max(3, Math.round((Math.abs(item.amountMinor) / maxMonthly) * 100))}%` }} /></div><span className="text-[10px] text-gray-400">{monthLabel(item.month)}</span></div>)}</div></SectionCard></div>
    <SectionCard title="Highest overdue balances"><div className="overflow-x-auto"><table className="w-full min-w-[580px] text-left text-sm"><thead className="border-b text-[10px] uppercase tracking-wide text-gray-400"><tr><th className="py-2">Case</th><th>Debtor</th><th>Due</th><th>Days overdue</th><th className="text-right">Outstanding</th></tr></thead><tbody>{metrics.topOverdue.map((item) => <tr key={item.caseId} className="border-b border-gray-50"><td className="py-3 font-mono text-xs"><Link href={`/cases/${item.caseId}`} className="text-[#009966]">{item.caseId}</Link></td><td className="font-semibold text-gray-800">{item.debtorName}</td><td className="text-xs text-gray-500">{item.dueDate}</td><td className="text-red-600">{item.daysOverdue}</td><td className="text-right font-bold text-red-600">{money(item.outstandingMinor)}</td></tr>)}{metrics.topOverdue.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-sm text-gray-400">No overdue balances.</td></tr>}</tbody></table></div></SectionCard>
    <div className="flex gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-[11px] text-gray-500"><BarChart2 className="h-4 w-4 shrink-0" />Financial totals are read on the server from the owner-scoped case projection and financial event ledger. CSV cells are protected from spreadsheet formula injection; exports are private and uncached.</div>
  </div>;
}

function Kpi({ label, value, color = "text-[#0D1B3D]" }: { label: string; value: string; color?: string }) { return <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"><p className="text-xs text-gray-500">{label}</p><p className={`mt-1 text-2xl font-black ${color}`}>{value}</p></div>; }
function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-xl bg-gray-50 p-3 text-center"><p className="text-xl font-black text-gray-900">{value}</p><p className="text-[11px] text-gray-500">{label}</p></div>; }
