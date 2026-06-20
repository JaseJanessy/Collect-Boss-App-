"use client";

import { useMemo } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { formatRM } from "@/lib/mock-data";
import { mockUploadedEvidence, evidenceTypes } from "@/lib/mock-legal-data";
import { mockPaymentRecords } from "@/lib/mock-payment-data";
import { useCases } from "@/hooks/use-cases";
import { computeCaseStats } from "@/lib/analytics/case-stats";
import { useEntitlements } from "@/hooks/use-entitlements";
import { UpgradePrompt } from "@/components/billing/upgrade-prompt";
import {
  TrendingUp, AlertCircle, Clock, DollarSign,
  FileText, ShieldCheck, BarChart2, ArrowRight, Gavel,
  ClipboardList, ChevronRight,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, accent, color, icon,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  color?: "red" | "amber" | "emerald" | "blue" | "purple";
  icon?: React.ReactNode;
}) {
  const colorMap = {
    red:     "text-red-600",
    amber:   "text-amber-600",
    emerald: "text-emerald-600",
    blue:    "text-blue-600",
    purple:  "text-purple-600",
  };
  return (
    <div className={cn(
      "rounded-2xl p-4 flex flex-col gap-1.5 border",
      accent ? "bg-[#0D1B3D] border-[#0D1B3D]" : "bg-white border-gray-100 shadow-sm"
    )}>
      {icon && (
        <div className={cn(
          "mb-0.5",
          accent ? "text-emerald-400" : (color ? colorMap[color] : "text-[#009966]")
        )}>
          {icon}
        </div>
      )}
      <p className={cn("text-xs font-medium", accent ? "text-blue-200" : "text-gray-500")}>
        {label}
      </p>
      <p className={cn(
        "text-2xl font-black leading-tight",
        accent ? "text-white" : (color ? colorMap[color] : "text-[#0D1B3D]")
      )}>
        {value}
      </p>
      {sub && (
        <p className={cn("text-[11px]", accent ? "text-blue-200" : "text-gray-400")}>
          {sub}
        </p>
      )}
    </div>
  );
}

function BarRow({ label, value, max, color, sub }: {
  label: string; value: number; max: number; color: string; sub?: string;
}) {
  const pct = max > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <p className="text-xs text-gray-600 w-24 shrink-0 truncate">{label}</p>
      <div className="flex-1 bg-gray-100 rounded-full h-2.5">
        <div className={cn("h-2.5 rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs font-bold text-gray-800 w-8 text-right shrink-0">{value}</p>
      {sub && <p className="text-[10px] text-gray-400 w-16 shrink-0">{sub}</p>}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function ReportsPage() {
  const { cases, loading }                   = useCases();
  const { entitlement, loading: entLoading } = useEntitlements();
  const stats = useMemo(() => computeCaseStats(cases), [cases]);

  // Evidence completeness (mock aggregate)
  const evidenceStats = useMemo(() => {
    const caseIds = Object.keys(mockUploadedEvidence);
    const mustHave = evidenceTypes.filter((e) => e.category === "must_have");
    let totalComplete = 0, totalPartial = 0, totalMissing = 0;
    for (const cid of caseIds) {
      const uploaded = new Set((mockUploadedEvidence[cid] ?? []).map((u) => u.typeId));
      const done = mustHave.filter((m) => uploaded.has(m.id)).length;
      if (done === mustHave.length) totalComplete++;
      else if (done > 0)           totalPartial++;
      else                         totalMissing++;
    }
    const unrecorded = Math.max(0, cases.length - caseIds.length);
    return { complete: totalComplete, partial: totalPartial, missing: totalMissing + unrecorded };
  }, [cases.length]);

  // Payment proof stats (mock)
  const proofStats = useMemo(() => ({
    pending:  mockPaymentRecords.filter((p) => p.proofStatus === "pending_review").length,
    approved: mockPaymentRecords.filter((p) => p.proofStatus === "approved").length,
    total:    mockPaymentRecords.length,
  }), []);

  // Monthly recovery mock data (last 6 months)
  const monthlyData = useMemo(() => {
    const base = stats.totalRecovered;
    return [
      { month: "Jan", amount: Math.round(base * 0.62) },
      { month: "Feb", amount: Math.round(base * 0.74) },
      { month: "Mar", amount: Math.round(base * 0.88) },
      { month: "Apr", amount: Math.round(base * 0.71) },
      { month: "May", amount: Math.round(base * 0.93) },
      { month: "Jun", amount: Math.round(base * 1.0)  },
    ];
  }, [stats.totalRecovered]);
  const maxMonthly = Math.max(...monthlyData.map((d) => d.amount), 1);

  if (loading || entLoading) return <LoadingSpinner />;

  // ── Feature gate: full reports require Boss/Pro ───────────────────────────
  if (!entitlement?.reports_enabled) {
    return (
      <div className="flex flex-col gap-6 pb-8 max-w-4xl">
        <div>
          <h1 className="text-xl font-black text-[#0D1B3D]">Reports &amp; Analytics</h1>
          <p className="text-sm text-gray-500 mt-0.5">Collection performance for your business.</p>
        </div>
        <UpgradePrompt
          feature="Reports & Analytics"
          reason="Full reports and analytics are available on the Boss plan and above."
          description="See your total recovery rate, monthly trends, overdue breakdown, evidence completeness, and payment proof statistics — all in one dashboard."
          planRequired="Boss"
          variant="page"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-8 max-w-4xl">

      {/* Page header */}
      <div>
        <h1 className="text-xl font-black text-[#0D1B3D]">Reports & Analytics</h1>
        <p className="text-sm text-gray-500 mt-0.5">Collection performance for your business.</p>
      </div>

      {/* Help tip for new users with no real data */}
      {cases.length === 0 && (
        <div className="bg-[#0D1B3D]/5 border border-[#0D1B3D]/10 rounded-xl px-4 py-3 flex gap-3">
          <BarChart2 className="w-4 h-4 text-[#0D1B3D]/50 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-[#0D1B3D]/80">Reports update as you add cases</p>
            <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
              Once you create cases and record payments, your real recovery data will appear here.
              The figures below are based on demo data.
            </p>
          </div>
        </div>
      )}

      {/* ── KPI strip ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KpiCard
          accent
          label="Total to Collect"
          value={formatRM(stats.totalToCollect)}
          sub={`${stats.active} active case${stats.active !== 1 ? "s" : ""}`}
          icon={<DollarSign className="w-4 h-4" />}
        />
        <KpiCard
          color="emerald"
          label="Total Recovered"
          value={formatRM(stats.totalRecovered)}
          sub={`${stats.recoveryRate}% recovery rate`}
          icon={<TrendingUp className="w-4 h-4" />}
        />
        <KpiCard
          color="red"
          label="Overdue Amount"
          value={formatRM(stats.overdueAmount)}
          sub={`${stats.overdue} case${stats.overdue !== 1 ? "s" : ""} overdue`}
          icon={<AlertCircle className="w-4 h-4" />}
        />
        <KpiCard
          label="Total Cases"
          value={String(stats.total)}
          sub={`${stats.paid} paid · ${stats.active} active`}
          icon={<ClipboardList className="w-4 h-4" />}
        />
        <KpiCard
          color="amber"
          label="Pending Proof Review"
          value={String(proofStats.pending)}
          sub="Payment proofs waiting"
          icon={<Clock className="w-4 h-4" />}
        />
        <KpiCard
          color="blue"
          label="Formal Demand Ready"
          value={String(stats.formalDemandReady + stats.actionNeeded)}
          sub={`${stats.smallClaimEligible} eligible for small claim`}
          icon={<FileText className="w-4 h-4" />}
        />
      </div>

      {/* ── Recovery rate ─────────────────────────────────────────────────── */}
      <SectionCard title="Collection Performance">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3">
          {[
            { label: "Amount Owed",   value: formatRM(stats.totalAmountOwed),  color: "text-gray-800" },
            { label: "Recovered",     value: formatRM(stats.totalRecovered),    color: "text-emerald-600" },
            { label: "Still Owed",    value: formatRM(stats.totalToCollect),    color: "text-red-600" },
            { label: "Recovery Rate", value: `${stats.recoveryRate}%`,          color: stats.recoveryRate >= 50 ? "text-emerald-600" : "text-amber-600" },
          ].map((row) => (
            <div key={row.label} className="text-center bg-[#F2F4F7] rounded-xl py-3 px-2">
              <p className={cn("text-xl font-black", row.color)}>{row.value}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">{row.label}</p>
            </div>
          ))}
        </div>

        {/* Recovery progress bar */}
        <div className="mt-4">
          <div className="flex justify-between text-[11px] text-gray-400 mb-1.5">
            <span>Recovered: {formatRM(stats.totalRecovered)}</span>
            <span>Remaining: {formatRM(stats.totalToCollect)}</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
            <div
              className="h-3 bg-[#009966] rounded-full"
              style={{ width: `${stats.recoveryRate}%` }}
            />
          </div>
          <p className="text-[11px] text-gray-400 mt-1">{stats.recoveryRate}% of total amount owed recovered</p>
        </div>
      </SectionCard>

      {/* ── Monthly recovery (mock chart) ─────────────────────────────────── */}
      <SectionCard title="Monthly Recovery Trend">
        <p className="text-[11px] text-gray-400 mt-1 mb-4">Last 6 months · Based on approved payments</p>
        <div className="flex items-end gap-2 h-28">
          {monthlyData.map((d) => {
            const barH = maxMonthly > 0 ? Math.max(8, Math.round((d.amount / maxMonthly) * 96)) : 8;
            return (
              <div key={d.month} className="flex-1 flex flex-col items-center gap-1.5">
                <p className="text-[9px] font-bold text-gray-500">{formatRM(d.amount).replace("RM ", "")}</p>
                <div className="w-full flex items-end justify-center">
                  <div
                    className="w-full rounded-t-lg bg-[#009966] opacity-80 hover:opacity-100 transition-opacity"
                    style={{ height: `${barH}px` }}
                    title={`${d.month}: ${formatRM(d.amount)}`}
                  />
                </div>
                <p className="text-[10px] text-gray-400 font-medium">{d.month}</p>
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-gray-300 mt-3 text-center">Estimated from mock data — connect Supabase for live data</p>
      </SectionCard>

      {/* ── Cases by status ────────────────────────────────────────────────── */}
      <SectionCard title="Cases by Status">
        <div className="flex flex-col gap-3 mt-3">
          {stats.byStatus.map((s) => (
            <BarRow
              key={s.label}
              label={s.label}
              value={s.count}
              max={stats.total}
              color={s.color}
              sub={`${Math.round((s.count / stats.total) * 100)}%`}
            />
          ))}
          {stats.byStatus.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-4">No cases yet.</p>
          )}
        </div>
      </SectionCard>

      {/* ── Overdue age buckets ────────────────────────────────────────────── */}
      {stats.ageBuckets.length > 0 && (
        <SectionCard title="Overdue Cases by Age">
          <p className="text-[11px] text-gray-400 mt-1 mb-3">
            {stats.overdue} overdue case{stats.overdue !== 1 ? "s" : ""} · {formatRM(stats.overdueAmount)} total
          </p>
          <div className="flex flex-col gap-3">
            {stats.ageBuckets.map((b) => (
              <div key={b.label}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-gray-700">{b.label}</p>
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-gray-500">{b.count} case{b.count !== 1 ? "s" : ""}</p>
                    <p className="text-xs font-bold text-gray-800">{formatRM(b.amount)}</p>
                  </div>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className={cn("h-2 rounded-full", b.color)}
                    style={{ width: `${Math.max(4, Math.round((b.count / stats.overdue) * 100))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* ── Top overdue cases ─────────────────────────────────────────────── */}
      {stats.topOverdue.length > 0 && (
        <SectionCard
          title="Top Overdue Cases"
          action={
            <Link href="/cases" className="flex items-center gap-0.5 text-xs text-[#009966] font-semibold">
              View All <ArrowRight className="w-3 h-3" />
            </Link>
          }
          noPadding
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {["Debtor", "Balance", "Days Overdue", "Status", ""].map((h, i) => (
                    <th key={h + i} className={cn(
                      "px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide",
                      i === 1 ? "text-right" : "text-left"
                    )}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {stats.topOverdue.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-sm font-semibold text-gray-900 leading-tight truncate max-w-[140px]">{c.debtor_name}</p>
                      <p className="text-[10px] text-gray-400 font-mono">{c.id}</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="text-sm font-bold text-red-600">{formatRM(c.balance)}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-red-500 font-semibold">{c.days_overdue}d</td>
                    <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                    <td className="px-4 py-3">
                      <Link href={`/cases/${c.id}`} className="text-[#009966] hover:text-emerald-700">
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* ── Payment proof review ──────────────────────────────────────────── */}
      <SectionCard title="Payment Proof Review">
        <div className="grid grid-cols-3 gap-3 mt-3">
          <div className="text-center bg-amber-50 border border-amber-100 rounded-xl py-3">
            <p className="text-xl font-black text-amber-600">{proofStats.pending}</p>
            <p className="text-[11px] text-amber-700 mt-0.5">Pending Review</p>
          </div>
          <div className="text-center bg-emerald-50 border border-emerald-100 rounded-xl py-3">
            <p className="text-xl font-black text-emerald-600">{proofStats.approved}</p>
            <p className="text-[11px] text-emerald-700 mt-0.5">Approved</p>
          </div>
          <div className="text-center bg-[#F2F4F7] rounded-xl py-3">
            <p className="text-xl font-black text-gray-700">{proofStats.total}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">Total Records</p>
          </div>
        </div>
        {proofStats.pending > 0 && (
          <Link
            href="/payments/requests"
            className="mt-3 flex items-center justify-between bg-amber-50 border border-amber-100 rounded-xl px-4 py-2.5 hover:border-amber-300 transition-colors"
          >
            <p className="text-xs font-semibold text-amber-800">Review pending proofs</p>
            <ArrowRight className="w-4 h-4 text-amber-600" />
          </Link>
        )}
      </SectionCard>

      {/* ── Evidence completeness ─────────────────────────────────────────── */}
      <SectionCard title="Evidence Completeness">
        <div className="grid grid-cols-3 gap-3 mt-3">
          <div className="text-center bg-emerald-50 border border-emerald-100 rounded-xl py-3">
            <p className="text-xl font-black text-emerald-600">{evidenceStats.complete}</p>
            <p className="text-[11px] text-emerald-700 mt-0.5">Complete</p>
          </div>
          <div className="text-center bg-amber-50 border border-amber-100 rounded-xl py-3">
            <p className="text-xl font-black text-amber-600">{evidenceStats.partial}</p>
            <p className="text-[11px] text-amber-700 mt-0.5">Partial</p>
          </div>
          <div className="text-center bg-red-50 border border-red-100 rounded-xl py-3">
            <p className="text-xl font-black text-red-600">{evidenceStats.missing}</p>
            <p className="text-[11px] text-red-700 mt-0.5">Missing</p>
          </div>
        </div>
        <div className="mt-3 flex gap-1 h-2 rounded-full overflow-hidden">
          {evidenceStats.complete > 0 && (
            <div className="bg-emerald-500" style={{ flex: evidenceStats.complete }} />
          )}
          {evidenceStats.partial > 0 && (
            <div className="bg-amber-400" style={{ flex: evidenceStats.partial }} />
          )}
          {evidenceStats.missing > 0 && (
            <div className="bg-red-400" style={{ flex: evidenceStats.missing }} />
          )}
        </div>
        <p className="text-[11px] text-gray-400 mt-1.5">
          Based on uploaded evidence files · {" "}
          <Link href="/documents" className="text-[#009966] font-semibold">View all →</Link>
        </p>
      </SectionCard>

      {/* ── Cases needing attention ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <AttentionCard
          icon={<FileText className="w-4 h-4" />}
          title="Formal Demand Ready"
          count={stats.formalDemandReady}
          color="text-orange-600"
          bg="bg-orange-50 border-orange-100"
          href="/cases"
          sub="Cases ready for demand letter"
        />
        <AttentionCard
          icon={<Gavel className="w-4 h-4" />}
          title="Small Claim Eligible"
          count={stats.smallClaimEligible}
          color="text-blue-600"
          bg="bg-blue-50 border-blue-100"
          href="/cases"
          sub={`Balance ≤ RM 5,000`}
        />
        <AttentionCard
          icon={<ShieldCheck className="w-4 h-4" />}
          title="Action Needed"
          count={stats.actionNeeded}
          color="text-purple-600"
          bg="bg-purple-50 border-purple-100"
          href="/cases"
          sub="Cases waiting for follow-up"
        />
      </div>

      {/* Disclaimer */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex gap-2">
        <BarChart2 className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-gray-500 leading-relaxed">
          Reports are generated from your CollectBoss case records. Monthly recovery trend uses mock
          estimates — connect Supabase for live data. Only your business data is shown.
        </p>
      </div>
    </div>
  );
}

// ─── Attention card ───────────────────────────────────────────────────────────

function AttentionCard({
  icon, title, count, color, bg, href, sub,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  color: string;
  bg: string;
  href: string;
  sub: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-start gap-3 rounded-2xl border px-4 py-4 hover:shadow-sm transition-shadow",
        bg
      )}
    >
      <div className={cn("mt-0.5", color)}>{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-900">{title}</p>
        <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>
      </div>
      <div className={cn("text-2xl font-black shrink-0", color)}>{count}</div>
    </Link>
  );
}

