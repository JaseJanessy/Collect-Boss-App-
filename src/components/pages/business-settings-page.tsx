"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SectionCard } from "@/components/ui/section-card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useAuth } from "@/hooks/use-auth";
import { useReceivingAccounts } from "@/hooks/use-receiving-accounts";
import { type ReceivingAccountRow } from "@/lib/supabase/types";
import {
  Building2, CreditCard, Lock, Bell, Shield, ChevronRight,
  Star, QrCode, Eye, ShieldCheck, Settings, Zap, ArrowRight,
} from "lucide-react";
import { PlanBadge } from "@/components/ui/plan-badge";
import { useEntitlements } from "@/hooks/use-entitlements";
import { PLANS, formatLimit, formatPlanPrice, PLAN_ORDER } from "@/lib/billing/plans";

// ─── Lock mode labels ─────────────────────────────────────────────────────────

const LOCK_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  immediate: {
    label: "Show Immediately",
    color: "bg-blue-100 text-blue-700 border-blue-200",
    icon:  <Eye className="w-3 h-3" />,
  },
  approval: {
    label: "Require Approval",
    color: "bg-emerald-100 text-emerald-700 border-emerald-200",
    icon:  <ShieldCheck className="w-3 h-3" />,
  },
  manual: {
    label: "Locked / Manual",
    color: "bg-orange-100 text-orange-700 border-orange-200",
    icon:  <Lock className="w-3 h-3" />,
  },
};

interface Props {
  dashboard?: boolean;
}

export function BusinessSettingsPage({ dashboard }: Props) {
  const { user } = useAuth();
  const { accounts, loading: acctLoading } = useReceivingAccounts();
  const { entitlement, loading: entLoading } = useEntitlements();

  const primaryAccount = accounts.find((a) => a.is_primary);

  return (
    <div className={cn("flex flex-col pb-6", !dashboard && "")}>
      {/* Mobile header */}
      {!dashboard && (
        <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
          <h1 className="text-lg font-bold text-[#0D1B3D]">Settings</h1>
          <p className="text-xs text-gray-400 mt-0.5">Business, payments and preferences.</p>
        </div>
      )}

      {/* Desktop header */}
      {dashboard && (
        <div className="mb-5">
          <h1 className="text-xl font-bold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500 mt-0.5">Business, payments and preferences.</p>
        </div>
      )}

      <div className={cn("flex flex-col gap-5", !dashboard && "px-4 pt-4")}>
        {/* Business profile */}
        <SectionCard title="Business Profile">
          <div className="flex items-center gap-3 mt-2">
            <div className="w-12 h-12 rounded-2xl bg-[#0D1B3D] flex items-center justify-center text-white text-base font-bold shrink-0">
              {(user?.name ?? user?.email ?? "?").slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900 truncate">
                {user?.name ?? "Business Owner"}
              </p>
              <p className="text-[11px] text-gray-400 truncate">{user?.email}</p>
            </div>
            <Link
              href="/onboarding/profile"
              className="shrink-0 text-xs font-semibold text-[#009966] hover:text-emerald-700"
            >
              Edit →
            </Link>
          </div>
        </SectionCard>

        {/* Receiving account */}
        <SectionCard
          title="Receiving Account"
          action={
            <Link href="/payments/account" className="text-xs text-[#009966] font-semibold">
              Manage →
            </Link>
          }
        >
          {acctLoading ? (
            <LoadingSpinner className="py-4" />
          ) : primaryAccount ? (
            <PrimaryAccountSummary account={primaryAccount} />
          ) : (
            <div className="mt-2">
              <p className="text-xs text-gray-400">No receiving account configured yet.</p>
              <Link
                href="/payments/account"
                className="inline-block mt-2 text-xs font-semibold text-[#009966] hover:text-emerald-700"
              >
                + Add receiving account
              </Link>
            </div>
          )}
        </SectionCard>

        {/* Payment policy */}
        <SectionCard title="Payment Lock Policy">
          <p className="text-[11px] text-gray-400 mt-1 mb-3 leading-relaxed">
            Payment lock mode can be set per case. Go to any case and tap
            &quot;Payment Access&quot; to control when debtors can see your bank details.
          </p>
          <div className="flex flex-col gap-2">
            {Object.entries(LOCK_LABELS).map(([mode, config]) => (
              <div key={mode} className="flex items-center gap-2.5 bg-[#F2F4F7] rounded-xl px-3 py-2.5">
                <div className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border",
                  config.color
                )}>
                  {config.icon}
                  {config.label}
                </div>
                <p className="text-[11px] text-gray-500 flex-1">
                  {mode === "immediate" && "Bank details shown right away"}
                  {mode === "approval" && "Debtor must request — you approve (recommended)"}
                  {mode === "manual" && "You share details yourself"}
                </p>
              </div>
            ))}
          </div>
          <Link
            href="/cases"
            className="inline-block mt-3 text-xs font-semibold text-[#009966] hover:text-emerald-700"
          >
            Manage lock mode per case →
          </Link>
        </SectionCard>

        {/* Quick links */}
        <SectionCard title="Quick Links">
          <div className="flex flex-col mt-1">
            {[
              { icon: <CreditCard className="w-4 h-4 text-emerald-600" />, label: "Payment Requests",   sub: "Review debtor payment requests", href: "/payments/requests" },
              { icon: <Shield className="w-4 h-4 text-blue-500" />,        label: "Payment History",    sub: "All recorded payments",          href: "/payments" },
              { icon: <Bell className="w-4 h-4 text-amber-500" />,         label: "Reminders Sent",     sub: "View all generated reminders",   href: "/cases" },
            ].map((item, i, arr) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 py-3 hover:bg-gray-50 -mx-4 px-4 transition-colors",
                  i < arr.length - 1 && "border-b border-gray-50"
                )}
              >
                <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
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

        {/* Billing & Plan */}
        <SectionCard
          title="Billing & Plan"
          action={
            <Link href="/billing" className="text-xs font-semibold text-[#009966] hover:text-emerald-700">
              Manage →
            </Link>
          }
        >
          {entLoading ? (
            <div className="py-3 text-xs text-gray-400">Loading plan…</div>
          ) : (
            <BillingSection planSlug={entitlement?.plan_slug ?? "free"} />
          )}
        </SectionCard>

        {/* Team members */}
        <SectionCard title="Team Members">
          <div className="mt-2">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-500">
                Team member invites are coming in a future update.
              </p>
              {entitlement && (
                <span className="text-[10px] font-bold text-gray-500">
                  Limit: {entitlement.team_member_limit === -1 ? "Unlimited" : entitlement.team_member_limit}
                </span>
              )}
            </div>
            {entitlement && entitlement.team_member_limit === 1 && (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
                <ArrowRight className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <p className="text-[11px] text-amber-700 flex-1">
                  Upgrade to Starter or higher to add team members.
                </p>
                <Link href="/billing" className="text-[10px] font-bold text-[#009966] hover:underline shrink-0">
                  Upgrade →
                </Link>
              </div>
            )}
          </div>
        </SectionCard>

        {/* Legal notice */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-[11px] text-amber-700 leading-relaxed">
            <strong>⚖️ Malaysian Compliance:</strong> Never expose debtor payment details publicly.
            Always use payment lock settings. Comply with PDPA (Personal Data Protection Act 2010).
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Billing section ─────────────────────────────────────────────────────────

function BillingSection({ planSlug }: { planSlug: string }) {
  const slug = (PLAN_ORDER.includes(planSlug as never) ? planSlug : "free") as import("@/lib/billing/types").PlanSlug;
  const plan = PLANS[slug];
  const isPaid = slug !== "free";

  const featureRows = [
    { label: "Cases",          value: formatLimit(plan.case_limit) },
    { label: "Evidence Packs", value: formatLimit(plan.evidence_pack_limit) },
    { label: "Team Members",   value: String(plan.team_member_limit) },
    { label: "Payment Lock",   value: plan.payment_lock_enabled    ? "✓ Included" : "✗ Not included" },
    { label: "Formal Demand",  value: plan.formal_demand_enabled   ? "✓ Included" : "✗ Not included" },
    { label: "Reports",        value: plan.reports_enabled         ? "✓ Included" : "✗ Not included" },
  ];

  return (
    <div className="mt-2 flex flex-col gap-3">
      {/* Current plan header */}
      <div className="flex items-center justify-between bg-[#F2F4F7] rounded-xl px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-[#0D1B3D]/10 flex items-center justify-center shrink-0">
            <Zap className="w-4 h-4 text-[#0D1B3D]" />
          </div>
          <div>
            <p className="text-xs font-bold text-[#0D1B3D]">Current Plan</p>
            <p className="text-[11px] text-gray-500">{formatPlanPrice(plan.monthly_price_rm)}</p>
          </div>
        </div>
        <PlanBadge slug={slug} size="md" />
      </div>

      {/* Feature summary */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {featureRows.map((row) => (
          <div key={row.label} className="flex items-center justify-between text-[11px]">
            <span className="text-gray-500">{row.label}</span>
            <span className={cn(
              "font-semibold",
              row.value.startsWith("✓") ? "text-[#009966]"
              : row.value.startsWith("✗") ? "text-gray-300"
              : "text-gray-700"
            )}>
              {row.value}
            </span>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-2 pt-1">
        <Link
          href="/billing"
          className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl text-xs font-bold bg-[#009966] hover:bg-[#00B377] text-white transition-colors"
        >
          <Zap className="w-3.5 h-3.5" />
          {isPaid ? "Change Plan" : "Upgrade Plan"}
        </Link>

        {isPaid && (
          <Link
            href="/billing"
            className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl text-xs font-bold border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Manage Subscription →
          </Link>
        )}
      </div>
    </div>
  );
}

// ─── Primary account summary ──────────────────────────────────────────────────

function PrimaryAccountSummary({ account }: { account: ReceivingAccountRow }) {
  return (
    <div className="mt-2 bg-[#F2F4F7] rounded-xl p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Building2 className="w-4 h-4 text-gray-500 shrink-0" />
        <div>
          <p className="text-xs font-bold text-gray-800">{account.bank_name}</p>
          <span className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">
            <Star className="w-2.5 h-2.5" /> Primary
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <p className="text-gray-400">Holder</p>
          <p className="font-semibold text-gray-700 truncate">{account.account_holder_name}</p>
        </div>
        <div>
          <p className="text-gray-400">Account No.</p>
          <p className="font-semibold text-gray-700 font-mono">{account.account_number}</p>
        </div>
      </div>
      {account.duitnow_id && (
        <div className="flex items-center gap-1.5">
          <QrCode className="w-3 h-3 text-[#009966]" />
          <p className="text-[11px] text-gray-600">
            DuitNow ID: <span className="font-semibold font-mono">{account.duitnow_id}</span>
          </p>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <Bell className="w-3 h-3 text-gray-400" />
        <p className="text-[11px] text-gray-500">
          {account.include_in_reminders ? "Included in reminders" : "Not included in reminders"}
        </p>
      </div>
    </div>
  );
}
