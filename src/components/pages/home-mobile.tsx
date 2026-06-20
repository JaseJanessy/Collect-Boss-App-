"use client";

import { useMemo } from "react";
import Link from "next/link";
import { SectionCard } from "@/components/ui/section-card";
import { CaseCard } from "@/components/ui/case-card";
import { formatRM, mockActivities, type ActivityType } from "@/lib/mock-data";
import { mockPaymentRecords } from "@/lib/mock-payment-data";
import { useCases } from "@/hooks/use-cases";
import { computeCaseStats } from "@/lib/analytics/case-stats";
import { cn } from "@/lib/utils";
import {
  DollarSign, TrendingUp, Calendar, AlertCircle, Plus,
  Send, FileText, CheckCircle2, MessageCircle, Clock,
  Phone, ArrowRight, Upload, BarChart2,
} from "lucide-react";
import { OnboardingChecklist } from "@/components/beta/onboarding-checklist";

const activityIconMap: Record<ActivityType, { icon: React.ReactNode; bg: string }> = {
  whatsapp:  { icon: <MessageCircle className="w-4 h-4 text-green-600" />,  bg: "bg-green-50"   },
  duitnow:   { icon: <DollarSign className="w-4 h-4 text-blue-600" />,     bg: "bg-blue-50"    },
  payment:   { icon: <CheckCircle2 className="w-4 h-4 text-emerald-600" />, bg: "bg-emerald-50" },
  promise:   { icon: <Clock className="w-4 h-4 text-amber-600" />,         bg: "bg-amber-50"   },
  call:      { icon: <Phone className="w-4 h-4 text-purple-600" />,        bg: "bg-purple-50"  },
  email:     { icon: <Send className="w-4 h-4 text-sky-600" />,            bg: "bg-sky-50"     },
  document:  { icon: <FileText className="w-4 h-4 text-gray-600" />,       bg: "bg-gray-100"   },
  demand:    { icon: <FileText className="w-4 h-4 text-orange-600" />,     bg: "bg-orange-50"  },
};

export function HomeMobile() {
  const { cases } = useCases();
  const stats = useMemo(() => computeCaseStats(cases), [cases]);
  const pendingProofs = mockPaymentRecords.filter((p) => p.proofStatus === "pending_review").length;

  const urgentCases = cases.filter(
    (c) => c.status === "overdue" || c.status === "action_needed" || c.status === "formal_demand_ready"
  );

  return (
    <div className="flex flex-col gap-5 pb-6">
      {/* ── Hero banner ───────────────────────────────────────────── */}
      <div className="bg-[#0D1B3D] px-4 pt-4 pb-7">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-blue-200 text-sm font-semibold">Good morning, Amin 👋</p>
            <p className="text-white/60 text-xs mt-0.5">Your collection overview</p>
          </div>
          <Link
            href="/reports"
            className="flex items-center gap-1 text-[10px] font-bold text-blue-200 border border-blue-600 rounded-xl px-2.5 py-1.5 hover:bg-blue-800 transition-colors"
          >
            <BarChart2 className="w-3 h-3" /> Report
          </Link>
        </div>

        {/* Hero numbers */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/10 rounded-2xl p-3.5">
            <p className="text-blue-200 text-[11px] font-medium">Money to Collect</p>
            <p className="text-white text-xl font-black mt-0.5 leading-tight">
              {formatRM(stats.totalToCollect)}
            </p>
            <p className="text-blue-300 text-[10px] mt-1">
              {stats.active} active case{stats.active !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="bg-[#009966]/80 rounded-2xl p-3.5">
            <p className="text-emerald-100 text-[11px] font-medium">Recovered</p>
            <p className="text-white text-xl font-black mt-0.5 leading-tight">
              {formatRM(stats.totalRecovered)}
            </p>
            <p className="text-emerald-200 text-[10px] mt-1">
              {stats.recoveryRate}% recovery rate
            </p>
          </div>
        </div>
      </div>

      <div className="px-4 flex flex-col gap-5">
        {/* ── Secondary stats strip ─────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-2 -mt-10">
          <MiniStat
            label="Overdue"
            value={String(stats.overdue)}
            color={stats.overdue > 0 ? "text-red-600" : "text-gray-400"}
            bg={stats.overdue > 0 ? "bg-red-50 border-red-100" : "bg-white border-gray-100"}
          />
          <MiniStat
            label="Pending Proofs"
            value={String(pendingProofs)}
            color={pendingProofs > 0 ? "text-amber-600" : "text-gray-400"}
            bg={pendingProofs > 0 ? "bg-amber-50 border-amber-100" : "bg-white border-gray-100"}
          />
          <MiniStat
            label="Paid"
            value={String(stats.paid)}
            color="text-emerald-600"
            bg="bg-emerald-50 border-emerald-100"
          />
        </div>

        {/* ── Beta onboarding checklist ────────────────────────────── */}
        <OnboardingChecklist variant="mobile" />

        {/* ── Alerts ────────────────────────────────────────────────── */}
        {(stats.overdue > 0 || pendingProofs > 0) && (
          <div className="flex flex-col gap-2">
            {stats.overdue > 0 && (
              <Link
                href="/cases"
                className="flex items-center gap-3 bg-red-50 border border-red-100 rounded-xl px-3.5 py-3 hover:border-red-300 transition-colors"
              >
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                <p className="text-xs font-semibold text-red-700 flex-1">
                  {stats.overdue} overdue case{stats.overdue !== 1 ? "s" : ""} — {formatRM(stats.overdueAmount)} at risk
                </p>
                <ArrowRight className="w-3.5 h-3.5 text-red-400 shrink-0" />
              </Link>
            )}
            {pendingProofs > 0 && (
              <Link
                href="/payments/requests"
                className="flex items-center gap-3 bg-amber-50 border border-amber-100 rounded-xl px-3.5 py-3 hover:border-amber-300 transition-colors"
              >
                <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                <p className="text-xs font-semibold text-amber-700 flex-1">
                  {pendingProofs} payment proof{pendingProofs !== 1 ? "s" : ""} waiting for review
                </p>
                <ArrowRight className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              </Link>
            )}
          </div>
        )}

        {/* ── Quick actions ─────────────────────────────────────────── */}
        <div>
          <p className="text-sm font-bold text-gray-900 mb-2.5">Quick Actions</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { icon: <Plus className="w-4 h-4" />,     label: "Add Case",       sub: "New recovery case",       href: "/add",             accent: true },
              { icon: <Send className="w-4 h-4" />,     label: "Send Reminder",  sub: "WhatsApp / Email",        href: "/actions",         accent: false },
              { icon: <CheckCircle2 className="w-4 h-4" />, label: "Review Payments", sub: `${pendingProofs} pending`, href: "/payments/requests", accent: false },
              { icon: <FileText className="w-4 h-4" />, label: "Evidence Pack",  sub: "Export PDF pack",         href: "/documents",       accent: false },
            ].map((btn) => (
              <Link key={btn.label} href={btn.href}>
                <div className={cn(
                  "flex items-center gap-2.5 rounded-2xl border px-3.5 py-3 hover:shadow-sm transition-shadow",
                  btn.accent
                    ? "bg-[#009966] border-[#009966] text-white"
                    : "bg-white border-gray-100 shadow-sm"
                )}>
                  <div className={cn(
                    "w-8 h-8 rounded-xl flex items-center justify-center shrink-0",
                    btn.accent ? "bg-white/20" : "bg-[#F2F4F7]"
                  )}>
                    <span className={btn.accent ? "text-white" : "text-[#009966]"}>
                      {btn.icon}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className={cn("text-xs font-bold truncate", btn.accent ? "text-white" : "text-gray-900")}>
                      {btn.label}
                    </p>
                    <p className={cn("text-[10px] truncate", btn.accent ? "text-emerald-100" : "text-gray-400")}>
                      {btn.sub}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* ── Cases needing attention ───────────────────────────────── */}
        {urgentCases.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-sm font-bold text-gray-900">
                Needs Attention
                <span className="ml-1.5 text-[10px] font-black text-white bg-red-500 rounded-full px-1.5 py-0.5">
                  {urgentCases.length}
                </span>
              </p>
              <Link href="/cases" className="text-xs text-[#009966] font-semibold flex items-center gap-0.5">
                View All <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="flex flex-col gap-3">
              {urgentCases.slice(0, 3).map((c) => (
                <CaseCard key={c.id} case={c} />
              ))}
            </div>
          </div>
        )}

        {/* ── Today's actions ───────────────────────────────────────── */}
        <SectionCard
          title="Today's Actions"
          action={
            <Link href="/actions" className="flex items-center gap-0.5 text-[#009966]">
              View All <ArrowRight className="w-3 h-3" />
            </Link>
          }
        >
          <div className="flex flex-col gap-2 mt-2">
            {[
              { icon: <Send className="w-4 h-4 text-emerald-600" />,  bg: "bg-emerald-50", label: "Send Reminder",      sub: "68% success rate",           href: "/actions" },
              { icon: <Upload className="w-4 h-4 text-blue-600" />,  bg: "bg-blue-50",    label: "Upload Evidence",     sub: "Strengthen your case",       href: "/cases" },
              { icon: <FileText className="w-4 h-4 text-orange-600" />, bg: "bg-orange-50", label: "Formal Demand Draft", sub: `${stats.formalDemandReady} cases ready`, href: "/documents" },
            ].map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="flex items-center gap-3 p-3 bg-[#F2F4F7] rounded-xl hover:bg-gray-100 transition-colors"
              >
                <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center shrink-0", item.bg)}>
                  {item.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{item.label}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{item.sub}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
              </Link>
            ))}
          </div>
        </SectionCard>

        {/* ── Recent activity ───────────────────────────────────────── */}
        <SectionCard
          title="Recent Activity"
          action={
            <span className="flex items-center gap-0.5 text-[#009966]">
              View All <ArrowRight className="w-3 h-3" />
            </span>
          }
        >
          <div className="flex flex-col mt-1">
            {mockActivities.slice(0, 4).map((act, i) => {
              const { icon, bg } = activityIconMap[act.type] ?? { icon: <Clock className="w-4 h-4 text-gray-400" />, bg: "bg-gray-100" };
              return (
                <Link
                  key={act.id}
                  href={`/cases/${act.caseId}`}
                  className={cn(
                    "flex items-center gap-3 py-3 hover:bg-gray-50 -mx-4 px-4 transition-colors",
                    i < Math.min(mockActivities.length, 4) - 1 && "border-b border-gray-50"
                  )}
                >
                  <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center shrink-0", bg)}>
                    {icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 truncate leading-tight">{act.description}</p>
                    <p className="text-[11px] text-gray-400 truncate mt-0.5">{act.debtorName}</p>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    {act.amount !== undefined && (
                      <p className="text-xs font-bold text-emerald-600">{formatRM(act.amount)}</p>
                    )}
                    <p className="text-[10px] text-gray-400 mt-0.5">{act.time}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

// ─── Mini stat chip ───────────────────────────────────────────────────────────

function MiniStat({ label, value, color, bg }: {
  label: string; value: string; color: string; bg: string;
}) {
  return (
    <div className={cn("rounded-xl border px-3 py-2.5 shadow-sm text-center", bg)}>
      <p className={cn("text-lg font-black leading-tight", color)}>{value}</p>
      <p className="text-[10px] text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}
