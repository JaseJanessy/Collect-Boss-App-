"use client";

import { useMemo } from "react";
import { StatCard } from "@/components/ui/stat-card";
import { SectionCard } from "@/components/ui/section-card";
import { ActionCard } from "@/components/ui/action-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { formatRM } from "@/lib/mock-data";
import { useCases } from "@/hooks/use-cases";
import { usePayments } from "@/hooks/use-payments";
import { computeCaseStats } from "@/lib/analytics/case-stats";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  DollarSign, TrendingUp, Clock, Plus, Send,
  Upload, FileText, ArrowRight, AlertCircle, CheckCircle2,
  BarChart2, ChevronRight,
} from "lucide-react";
import { OnboardingChecklist } from "@/components/beta/onboarding-checklist";
import { PlanBadge } from "@/components/ui/plan-badge";
import { useEntitlements } from "@/hooks/use-entitlements";
import { UsageMeter } from "@/components/billing/usage-meter";
import { useReportSummary } from "@/hooks/use-report-summary";

export function HomeDashboard() {
  const { cases, loading } = useCases();
  const { payments, loading: paymentsLoading } = usePayments();
  const stats = useMemo(() => computeCaseStats(cases), [cases]);
  const pendingProofs = payments.filter((p) => p.review_status === "pending_review").length;
  const { entitlement } = useEntitlements();
  const { metrics, loading: reportLoading } = useReportSummary();
  const allowLocalMockSummary =
    process.env.NEXT_PUBLIC_APP_ENV === "development" &&
    process.env.NEXT_PUBLIC_ENABLE_MOCK_DATA === "true";
  const reportMoney = (minor: number) => formatRM(minor / 100);
  const overdueAtRiskMinor = metrics?.ageing
    .filter((item) => item.label !== "Current")
    .reduce((sum, item) => sum + item.amountMinor, 0) ?? 0;
  const ledgerUnavailableLabel = reportLoading
    ? "Loading ledger balance"
    : "Ledger summary unavailable";

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto">
      {/* ── Beta onboarding checklist ────────────────────────────────────── */}
      <OnboardingChecklist variant="dashboard" />

      {/* Greeting */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900">Good morning, Amin! 👋</h1>
            {entitlement && (
              <PlanBadge slug={entitlement.plan_slug} size="sm" />
            )}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {(metrics?.overdueCases ?? stats.overdue) > 0
              ? `${metrics?.overdueCases ?? stats.overdue} overdue case${(metrics?.overdueCases ?? stats.overdue) !== 1 ? "s" : ""} need attention.`
              : "Here’s your collection overview."}
          </p>
        </div>
        <Link
          href="/reports"
          className="flex items-center gap-1.5 text-xs font-semibold text-[#009966] hover:text-emerald-700 border border-emerald-200 rounded-xl px-3 py-2 hover:bg-emerald-50 transition-colors"
        >
          <BarChart2 className="w-3.5 h-3.5" />
          Full Report
        </Link>
      </div>

      {/* ── KPI cards row ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Money to Collect"
          value={metrics ? reportMoney(metrics.totalOutstandingMinor) : allowLocalMockSummary ? formatRM(stats.totalToCollect) : "—"}
          sub={metrics ? `Across ${metrics.activeCases} active cases` : allowLocalMockSummary ? `Across ${stats.active} active cases` : ledgerUnavailableLabel}
          icon={<DollarSign className="w-4 h-4" />}
          accent
        />
        <StatCard
          label="Total Recovered"
          value={metrics ? reportMoney(metrics.totalCollectedMinor) : allowLocalMockSummary ? formatRM(stats.totalRecovered) : "—"}
          sub={metrics ? `${metrics.collectionRate}% collection rate` : allowLocalMockSummary ? `${stats.recoveryRate}% recovery rate` : ledgerUnavailableLabel}
          trend={metrics ? `${metrics.collectionRate}% collected` : allowLocalMockSummary ? `${stats.recoveryRate}% recovered` : undefined}
          trendUp={(metrics?.collectionRate ?? stats.recoveryRate) >= 50}
          icon={<TrendingUp className="w-4 h-4" />}
        />
        <StatCard
          label="Overdue Cases"
          value={metrics ? String(metrics.overdueCases) : allowLocalMockSummary ? String(stats.overdue) : "—"}
          sub={metrics ? (metrics.overdueCases > 0 ? `${reportMoney(overdueAtRiskMinor)} at risk` : "All on track") : allowLocalMockSummary ? `${formatRM(stats.overdueAmount)} at risk` : ledgerUnavailableLabel}
          icon={<AlertCircle className="w-4 h-4" />}
        />
        <StatCard
          label="Pending Proofs"
          value={String(pendingProofs)}
          sub="Payment proofs to review"
          icon={<Clock className="w-4 h-4" />}
        />
      </div>

      {/* ── Plan usage meters ────────────────────────────────────────────── */}
      {entitlement && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Plan Usage</p>
            <PlanBadge slug={entitlement.plan_slug} size="sm" />
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <UsageMeter
              label="Active cases"
              current={cases.length}
              limit={entitlement.case_limit}
            />
            <UsageMeter
              label="Evidence packs"
              current={0}
              limit={entitlement.evidence_pack_limit}
              showUpgrade={false}
            />
          </div>
        </div>
      )}

      {/* ── Middle row: Pipeline + Quick actions ──────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Collection pipeline */}
        <div className="lg:col-span-2">
          <SectionCard title="Collection Pipeline">
            <div className="grid grid-cols-3 gap-3 mt-3">
              {[
                { label: "Action Needed",    count: stats.actionNeeded,     amount: cases.filter(c => c.status === "action_needed").reduce((s, c) => s + c.balance, 0),    color: "bg-purple-100 text-purple-700 border-purple-200" },
                { label: "Payment Promise",  count: stats.paymentPromise,   amount: cases.filter(c => c.status === "payment_promise").reduce((s, c) => s + c.balance, 0),  color: "bg-amber-100 text-amber-700 border-amber-200" },
                { label: "Formal Demand",    count: stats.formalDemandReady, amount: cases.filter(c => c.status === "formal_demand_ready").reduce((s, c) => s + c.balance, 0), color: "bg-orange-100 text-orange-700 border-orange-200" },
              ].map((stage) => (
                <Link key={stage.label} href="/cases" className="group">
                  <div className={cn(
                    "rounded-xl border p-3.5 text-center hover:shadow-sm transition-shadow",
                    stage.color
                  )}>
                    <p className="text-2xl font-black">{stage.count}</p>
                    <p className="text-[11px] font-semibold mt-0.5">{stage.label}</p>
                    <p className="text-[10px] opacity-70 mt-0.5">{formatRM(stage.amount)}</p>
                  </div>
                </Link>
              ))}
            </div>

            {/* Recovery bar */}
            <div className="mt-4">
              <div className="flex justify-between text-[11px] text-gray-400 mb-1.5">
                <span>Recovered: {metrics ? reportMoney(metrics.totalCollectedMinor) : allowLocalMockSummary ? formatRM(stats.totalRecovered) : "—"}</span>
                <span>{metrics ? `${metrics.collectionRate}%` : allowLocalMockSummary ? `${stats.recoveryRate}%` : "—"}</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                <div className="h-2.5 bg-[#009966]" style={{ width: `${metrics?.collectionRate ?? (allowLocalMockSummary ? stats.recoveryRate : 0)}%` }} />
              </div>
              <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                <span>0</span>
                <span>{metrics ? reportMoney(metrics.totalContractualDueMinor) : allowLocalMockSummary ? formatRM(stats.totalAmountOwed) : "—"}</span>
              </div>
            </div>
          </SectionCard>
        </div>

        {/* Quick actions */}
        <SectionCard title="Quick Actions">
          <div className="grid grid-cols-2 gap-2 mt-1">
            <Link href="/add">
              <ActionCard icon={<Plus className="w-4 h-4" />}    label="Add Case"       description="New recovery"    variant="primary" />
            </Link>
            <Link href="/actions">
              <ActionCard icon={<Send className="w-4 h-4" />}    label="Send Reminder"  description="WhatsApp / email" successRate="68%" />
            </Link>
            <Link href="/cases">
              <ActionCard icon={<Upload className="w-4 h-4" />}  label="Upload Evidence" description="Docs & files" />
            </Link>
            <Link href="/payments/requests">
              <ActionCard icon={<FileText className="w-4 h-4" />} label="Review Proofs"  description="Pending review" />
            </Link>
          </div>
        </SectionCard>
      </div>

      {/* ── Pending approvals ─────────────────────────────────────────── */}
      {pendingProofs > 0 && (
        <SectionCard
          title="Pending Approvals"
          action={
            <Link href="/payments/requests" className="flex items-center gap-0.5 text-xs text-[#009966] font-semibold">
              Review All <ArrowRight className="w-3 h-3" />
            </Link>
          }
        >
          <div className="flex items-center gap-4 mt-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
              <Clock className="w-6 h-6 text-amber-500" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-gray-900">
                {pendingProofs} payment proof{pendingProofs !== 1 ? "s" : ""} awaiting review
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                Review and approve or reject debtor payment submissions
              </p>
            </div>
            <Link
              href="/payments/requests"
              className="flex items-center gap-1.5 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 hover:bg-amber-100 transition-colors shrink-0"
            >
              Review <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </SectionCard>
      )}

      {/* ── Top overdue + Recent cases (2 col) ───────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top overdue */}
        <SectionCard
          title="Top Overdue Cases"
          action={
            <Link href="/cases" className="flex items-center gap-0.5 text-xs text-[#009966] font-semibold">
              All Cases <ArrowRight className="w-3 h-3" />
            </Link>
          }
        >
          {stats.topOverdue.length === 0 ? (
            <div className="flex items-center gap-2 mt-3 py-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <p className="text-xs text-gray-500">No overdue cases. Great work!</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2 mt-3">
              {stats.topOverdue.map((c) => (
                <Link
                  key={c.id}
                  href={`/cases/${c.id}`}
                  className="flex items-center gap-2.5 p-2.5 bg-red-50 border border-red-100 rounded-xl hover:border-red-200 transition-colors"
                >
                  <div className="w-8 h-8 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                    <AlertCircle className="w-4 h-4 text-red-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-gray-900 truncate">{c.debtor_name}</p>
                    <p className="text-[10px] text-red-500">{c.days_overdue}d overdue</p>
                  </div>
                  <p className="text-xs font-black text-red-600 shrink-0">{formatRM(c.balance)}</p>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Recent cases */}
        <SectionCard
          title="Recent Cases"
          action={
            <Link href="/cases" className="flex items-center gap-0.5 text-xs text-[#009966] font-semibold">
              View All <ArrowRight className="w-3 h-3" />
            </Link>
          }
        >
          {loading || paymentsLoading ? (
            <LoadingSpinner />
          ) : stats.recentCases.length === 0 ? (
            <div className="mt-3 py-4 text-center">
              <p className="text-xs text-gray-400">No cases yet.</p>
              <Link href="/add" className="text-xs text-[#009966] font-semibold mt-1 inline-block">
                Add your first case →
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-2 mt-3">
              {stats.recentCases.slice(0, 5).map((c) => (
                <Link
                  key={c.id}
                  href={`/cases/${c.id}`}
                  className="flex items-center gap-2.5 hover:bg-gray-50 rounded-xl p-2 -mx-2 transition-colors"
                >
                  <div className="w-8 h-8 rounded-xl bg-[#0D1B3D] flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                    {c.debtor_name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-gray-900 truncate">{c.debtor_name}</p>
                    <p className="text-[10px] text-gray-400">{c.id}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-bold text-gray-800">{formatRM(c.balance)}</p>
                    <StatusBadge status={c.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── Cases status table ─────────────────────────────────────────── */}
      <SectionCard
        title="All Cases"
        action={
          <Link href="/cases" className="flex items-center gap-1 text-xs text-[#009966] font-semibold hover:text-emerald-700">
            View All <ArrowRight className="w-3 h-3" />
          </Link>
        }
        noPadding
      >
        {loading || paymentsLoading ? (
          <LoadingSpinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {["Case ID", "Debtor", "Balance", "Due Date", "Status", ""].map((h, i) => (
                    <th key={h + i} className={cn(
                      "px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide",
                      i === 2 ? "text-right" : "text-left"
                    )}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {cases.slice(0, 8).map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50 cursor-pointer transition-colors">
                    <td className="px-4 py-3 text-xs text-gray-400 font-mono">{c.id}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900 text-sm truncate max-w-[160px]">{c.debtor_name}</p>
                      {c.debtor_location && <p className="text-xs text-gray-400">{c.debtor_location}</p>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-bold text-gray-900">{formatRM(c.balance)}</p>
                      {c.days_overdue > 0 && <p className="text-xs text-red-500">{c.days_overdue}d overdue</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{c.due_date}</td>
                    <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                    <td className="px-4 py-3">
                      <Link href={`/cases/${c.id}`} className="text-gray-300 hover:text-[#009966]">
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
                {cases.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                      No cases yet.{" "}
                      <Link href="/add" className="text-[#009966] font-semibold hover:underline">
                        Add your first case →
                      </Link>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
