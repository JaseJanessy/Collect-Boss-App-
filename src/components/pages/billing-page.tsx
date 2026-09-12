"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useEntitlements } from "@/hooks/use-entitlements";
import { PLANS, PLAN_ORDER, formatLimit, PLAN_BADGE } from "@/lib/billing/plans";
import type { PlanSlug } from "@/lib/billing/types";
import {
  CheckCircle2,
  XCircle,
  Zap,
  ArrowRight,
  Loader2,
  ShieldCheck,
  FileText,
  ClipboardList,
  Users,
  BarChart2,
  Gavel,
  AlertCircle,
  Star,
  Clock,
  RefreshCw,
  Settings,
  CreditCard,
  Receipt,
  Calendar,
} from "lucide-react";
import { useSubscription } from "@/hooks/use-subscription";
import { useCustomerPortal } from "@/hooks/use-customer-portal";
import type { SubscriptionStatus } from "@/lib/billing/types";
import { appEnvironment } from "@/lib/supabase/client";

// ─── Feature rows shown on every plan card ────────────────────────────────────

interface FeatureRow {
  label:   string;
  icon:    React.ReactNode;
  getValue: (p: typeof PLANS[PlanSlug]) => string | boolean;
}

const FEATURE_ROWS: FeatureRow[] = [
  {
    label:    "Active cases",
    icon:     <ClipboardList className="w-3.5 h-3.5" />,
    getValue: (p) => formatLimit(p.case_limit),
  },
  {
    label:    "Evidence packs",
    icon:     <FileText className="w-3.5 h-3.5" />,
    getValue: (p) => formatLimit(p.evidence_pack_limit),
  },
  {
    label:    "Team members",
    icon:     <Users className="w-3.5 h-3.5" />,
    getValue: (p) => String(p.team_member_limit),
  },
  {
    label:    "Payment Lock",
    icon:     <ShieldCheck className="w-3.5 h-3.5" />,
    getValue: (p) => p.payment_lock_enabled,
  },
  {
    label:    "Formal Payment Notice",
    icon:     <FileText className="w-3.5 h-3.5" />,
    getValue: (p) => p.formal_demand_enabled,
  },
  {
    label:    "Request Legal Review",
    icon:     <Gavel className="w-3.5 h-3.5" />,
    getValue: (p) => p.lawyer_referral_enabled,
  },
  {
    label:    "Reports & Analytics",
    icon:     <BarChart2 className="w-3.5 h-3.5" />,
    getValue: (p) => p.reports_enabled,
  },
];

// ─── Subscribe hook ───────────────────────────────────────────────────────────

function useCheckout() {
  const [loading, setLoading]   = useState<PlanSlug | null>(null);
  const [error,   setError]     = useState<string | null>(null);

  async function subscribe(slug: PlanSlug) {
    setLoading(slug);
    setError(null);

    try {
      const res = await fetch("/api/billing/create-checkout-session", {
        method:  "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body:    JSON.stringify({ plan_slug: slug }),
      });

      const data: { url?: string; error?: string } = await res.json();

      if (!res.ok || !data.url) {
        setError(data.error ?? "Could not start checkout. Please try again.");
        setLoading(null);
        return;
      }

      // Redirect to Stripe Checkout (full page navigation)
      window.location.href = data.url;
      // Keep loading state — page will leave
    } catch {
      setError("Network error. Please check your connection and try again.");
      setLoading(null);
    }
  }

  return { loading, error, subscribe };
}

// ─── Main component ───────────────────────────────────────────────────────────

interface BillingPageProps {
  dashboard?: boolean;
  selectedPlan?: PlanSlug;
}

export function BillingPage({ dashboard, selectedPlan }: BillingPageProps) {
  const { entitlement, loading: entLoading, error: entitlementError } = useEntitlements();
  const { subscription, loading: subLoading, refresh, error: subscriptionError } = useSubscription();
  const { loading: checkoutLoading, error: checkoutError, subscribe } = useCheckout();

  const currentSlug: PlanSlug         = entitlement?.plan_slug ?? "free";
  const subStatus: SubscriptionStatus = subscription?.status   ?? "active";

  // Activation pending: Stripe subscription active but entitlement not yet upgraded.
  // This happens in the brief window between checkout completion and webhook processing.
  const activationPending =
    !entLoading &&
    !subLoading &&
    subscription?.status === "active" &&
    subscription?.plan_slug !== "free" &&
    entitlement?.plan_slug === "free";

  if (entitlementError || subscriptionError) return <section role="alert" className="cb-surface mx-auto max-w-xl p-6"><h1 className="cb-page-title">Billing information unavailable</h1><p className="cb-page-description">We could not confirm your current plan or subscription. Please retry before making billing changes.</p><button onClick={() => window.location.reload()} className="cb-button-secondary mt-5">Try again</button></section>;

  return (
    <div className={cn("flex flex-col pb-8", !dashboard && "")}>
      {/* ── Mobile header ──────────────────────────────────────────────── */}
      {!dashboard && (
        <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
          <h1 className="text-lg font-bold text-[#0D1B3D]">Billing & Plan</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Choose the right plan for your business.
          </p>
        </div>
      )}

      {/* ── Desktop header ─────────────────────────────────────────────── */}
      {dashboard && (
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">Billing &amp; Plan</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Choose the right plan for your business.
          </p>
        </div>
      )}

      <div className={cn("flex flex-col gap-6", !dashboard && "px-4 pt-4")}> 
        {selectedPlan && selectedPlan !== currentSlug && (
          <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-bold text-emerald-900">Your {PLANS[selectedPlan].name} selection is ready</p>
            <p className="mt-1 text-xs text-emerald-800">Review the highlighted plan and continue when you are ready. You have not been charged.</p>
          </div>
        )}
        {/* ── Activation pending banner ────────────────────────────────── */}
        {activationPending && (
          <ActivationPendingBanner onRefresh={refresh} />
        )}

        {/* ── Subscription status alert (non-active states) ───────────── */}
        {!subLoading && subscription && !activationPending && (
          <SubscriptionStatusAlert
            status={subStatus}
            periodEnd={subscription.current_period_end}
            cancelAtPeriodEnd={subscription.cancel_at_period_end}
          />
        )}

        {/* ── Current plan banner ──────────────────────────────────────── */}
        <CurrentPlanBanner
          slug={currentSlug}
          status={subStatus}
          loading={entLoading || subLoading}
        />

        {/* ── Subscription management (only shown when on a paid plan) ─── */}
        {!subLoading && subscription && subscription.plan_slug !== "free" && (
          <SubscriptionManagementCard subscription={subscription} />
        )}

        {/* ── Checkout error ───────────────────────────────────────────── */}
        {checkoutError && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-xl p-4">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-red-700">Checkout failed</p>
              <p className="text-[11px] text-red-600 mt-0.5">{checkoutError}</p>
            </div>
          </div>
        )}

        {/* ── Plan cards ───────────────────────────────────────────────── */}
        <div
          id="plans"
          className={cn(
            "grid gap-4",
            dashboard
              ? "grid-cols-2 lg:grid-cols-4"
              : "grid-cols-1",
          )}
        >
          {PLAN_ORDER.map((slug) => (
            <PlanCard
              key={slug}
              slug={slug}
              isCurrent={slug === currentSlug}
              isLoading={checkoutLoading === slug}
              anyLoading={checkoutLoading !== null}
              onSubscribe={() => subscribe(slug)}
            />
          ))}
        </div>

        {appEnvironment !== "production" && <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-amber-800">{appEnvironment === "staging" ? "Staging" : "Development"} — Stripe Test Mode</p>
            <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
              Payments are in test mode. Use Stripe test card{" "}
              <span className="font-mono font-bold">4242 4242 4242 4242</span> with any
              future expiry and any CVC to test a subscription.
              No real charges will be made.
            </p>
          </div>
        </div>}

        {/* ── Legal ────────────────────────────────────────────────────── */}
        <p className="text-[11px] text-gray-400 text-center leading-relaxed">
          Prices shown in Ringgit Malaysia (RM) and billed monthly.
          Cancel anytime. Subscription management powered by Stripe.
          CollectBoss does not store your card details.
        </p>
      </div>
    </div>
  );
}

// ─── Subscription management card ────────────────────────────────────────────

function SubscriptionManagementCard({
  subscription,
}: {
  subscription: import("@/lib/billing/types").SubscriptionRow;
}) {
  const { openPortal, loading: portalLoading, error: portalError } = useCustomerPortal();
  const badge    = PLAN_BADGE[subscription.plan_slug];
  const statusPill = STATUS_PILL[subscription.status];

  // Format period end date
  const periodEndFormatted = subscription.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString("en-MY", {
        day: "numeric", month: "long", year: "numeric",
      })
    : null;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-[#009966]" />
          <p className="text-sm font-black text-[#0D1B3D]">Subscription</p>
        </div>
        <div className="flex items-center gap-2">
          {statusPill && (
            <span className={cn(
              "text-[9px] font-bold border px-1.5 py-0.5 rounded-full",
              statusPill.color,
            )}>
              {statusPill.label}
            </span>
          )}
          <span className={cn(
            "text-[10px] font-bold border px-2 py-0.5 rounded-full",
            badge.color,
          )}>
            {badge.label}
          </span>
        </div>
      </div>

      {/* Details */}
      <div className="px-5 py-4 flex flex-col gap-3">
        {/* Period end */}
        {periodEndFormatted && (
          <div className="flex items-center gap-3">
            <Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <div>
              <p className="text-[11px] text-gray-500">
                {subscription.cancel_at_period_end
                  ? "Access ends on"
                  : "Next renewal"
                }
              </p>
              <p className="text-xs font-semibold text-gray-800">{periodEndFormatted}</p>
            </div>
          </div>
        )}

        {/* Cancel at period end warning */}
        {subscription.cancel_at_period_end && (
          <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
            <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-700 leading-snug">
              Your subscription is set to cancel at the end of the current period.
              You will be downgraded to the Free plan on {periodEndFormatted}.
              Reactivate in the portal to keep your plan.
            </p>
          </div>
        )}

        {/* Portal error */}
        {portalError && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
            <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-700">{portalError}</p>
          </div>
        )}

        {/* Buttons */}
        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          {/* Manage Subscription → Stripe Portal */}
          <button
            onClick={openPortal}
            disabled={portalLoading}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all border",
              "bg-[#0D1B3D] hover:bg-[#1a2d5a] text-white border-[#0D1B3D]",
              portalLoading && "opacity-60 cursor-not-allowed",
            )}
          >
            {portalLoading
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Opening portal…</>
              : <><Settings className="w-3.5 h-3.5" /> Manage Subscription</>
            }
          </button>

          {/* Change Plan → scroll to plan cards */}
          <Link
            href="#plans"
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition-colors"
          >
            <Zap className="w-3.5 h-3.5 text-[#009966]" />
            Change Plan
          </Link>
        </div>

        {/* What you can do in the portal */}
        <div className="grid grid-cols-2 gap-1.5 mt-1">
          {[
            { icon: <CreditCard className="w-3 h-3" />, label: "Update payment method" },
            { icon: <Receipt    className="w-3 h-3" />, label: "View invoices"          },
            { icon: <Settings   className="w-3 h-3" />, label: "Update billing details" },
            { icon: <XCircle    className="w-3 h-3" />, label: "Cancel subscription"    },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <span className="text-gray-300">{item.icon}</span>
              {item.label}
            </div>
          ))}
        </div>
      </div>

      {/* Billing history placeholder */}
      <div className="px-5 py-3 border-t border-gray-50 bg-gray-50/40">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold text-gray-500 flex items-center gap-1.5">
            <Receipt className="w-3.5 h-3.5" />
            Billing history
          </p>
          <button
            onClick={openPortal}
            disabled={portalLoading}
            className="text-[10px] font-bold text-[#009966] hover:underline disabled:opacity-50"
          >
            View invoices in Stripe →
          </button>
        </div>
        <p className="text-[10px] text-gray-400 mt-1">
          Full invoice history is available in the Stripe billing portal.
        </p>
      </div>
    </div>
  );
}

// ─── Activation pending banner ────────────────────────────────────────────────

function ActivationPendingBanner({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl p-4">
      <Clock className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="text-xs font-bold text-blue-800">
          Payment confirmed — activation in progress
        </p>
        <p className="text-[11px] text-blue-700 mt-0.5 leading-relaxed">
          Your payment has been confirmed by Stripe. Your subscription is being activated.
          This may take a few seconds.
        </p>
      </div>
      <button
        onClick={onRefresh}
        className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-blue-700 hover:text-blue-900 bg-blue-100 hover:bg-blue-200 px-2 py-1.5 rounded-lg transition-colors"
      >
        <RefreshCw className="w-3 h-3" /> Refresh
      </button>
    </div>
  );
}

// ─── Subscription status alert ───────────────────────────────────────────────

const STATUS_ALERT: Partial<Record<SubscriptionStatus, {
  bg: string; border: string; icon: React.ReactNode; title: string; body: string;
}>> = {
  past_due: {
    bg:     "bg-red-50",
    border: "border-red-200",
    icon:   <AlertCircle className="w-4 h-4 text-red-500" />,
    title:  "Payment failed",
    body:   "Your last payment failed. Features have been restricted to the Free plan until payment succeeds. Please update your payment method in Stripe.",
  },
  canceled: {
    bg:     "bg-gray-50",
    border: "border-gray-200",
    icon:   <XCircle className="w-4 h-4 text-gray-400" />,
    title:  "Subscription canceled",
    body:   "Your subscription has been canceled. You are now on the Free plan. Subscribe again below to regain access.",
  },
  unpaid: {
    bg:     "bg-red-50",
    border: "border-red-200",
    icon:   <AlertCircle className="w-4 h-4 text-red-500" />,
    title:  "Payment unpaid",
    body:   "We could not collect payment. Your account has been restricted. Please update your payment method.",
  },
  incomplete: {
    bg:     "bg-amber-50",
    border: "border-amber-200",
    icon:   <Clock className="w-4 h-4 text-amber-500" />,
    title:  "Payment incomplete",
    body:   "Your payment is still processing. Features will be unlocked once Stripe confirms the transaction.",
  },
  incomplete_expired: {
    bg:     "bg-gray-50",
    border: "border-gray-200",
    icon:   <XCircle className="w-4 h-4 text-gray-400" />,
    title:  "Checkout expired",
    body:   "Your checkout session expired before payment was completed. Subscribe again below.",
  },
};

function SubscriptionStatusAlert({
  status,
  periodEnd,
  cancelAtPeriodEnd,
}: {
  status:             SubscriptionStatus;
  periodEnd:          string | null;
  cancelAtPeriodEnd:  boolean;
}) {
  // Only show for non-healthy statuses (active/trialing are fine)
  const alert = STATUS_ALERT[status];

  // Show "will cancel" warning for active subscriptions scheduled to cancel
  if ((status === "active" || status === "trialing") && cancelAtPeriodEnd && periodEnd) {
    const endDate = new Date(periodEnd).toLocaleDateString("en-MY", {
      day: "numeric", month: "long", year: "numeric",
    });
    return (
      <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3.5">
        <Clock className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <p className="text-[11px] text-amber-700 leading-relaxed">
          <strong>Cancels on {endDate}.</strong> Your subscription will not renew.
          You will retain access until then.
        </p>
      </div>
    );
  }

  if (!alert) return null;

  return (
    <div className={cn(
      "flex items-start gap-3 rounded-xl border p-3.5",
      alert.bg, alert.border,
    )}>
      <span className="shrink-0 mt-0.5">{alert.icon}</span>
      <div>
        <p className="text-xs font-bold text-gray-800">{alert.title}</p>
        <p className="text-[11px] text-gray-600 mt-0.5 leading-relaxed">{alert.body}</p>
      </div>
    </div>
  );
}

// ─── Subscription status pill ─────────────────────────────────────────────────

const STATUS_PILL: Partial<Record<SubscriptionStatus, { label: string; color: string }>> = {
  active:              { label: "Active",    color: "bg-emerald-50 text-[#009966] border-emerald-200" },
  trialing:            { label: "Trial",     color: "bg-blue-50 text-blue-700 border-blue-200" },
  past_due:            { label: "Past Due",  color: "bg-red-50 text-red-700 border-red-200" },
  canceled:            { label: "Canceled",  color: "bg-gray-100 text-gray-500 border-gray-200" },
  incomplete:          { label: "Pending",   color: "bg-amber-50 text-amber-700 border-amber-200" },
  incomplete_expired:  { label: "Expired",   color: "bg-gray-100 text-gray-500 border-gray-200" },
  unpaid:              { label: "Unpaid",    color: "bg-red-50 text-red-700 border-red-200" },
  paused:              { label: "Paused",    color: "bg-gray-100 text-gray-500 border-gray-200" },
};

// ─── Current plan banner ──────────────────────────────────────────────────────

function CurrentPlanBanner({
  slug, status, loading,
}: {
  slug:    PlanSlug;
  status:  SubscriptionStatus;
  loading: boolean;
}) {
  const badge      = PLAN_BADGE[slug];
  const plan       = PLANS[slug];
  const statusPill = STATUS_PILL[status];

  if (loading) {
    return (
      <div className="h-14 bg-gray-100 rounded-2xl animate-pulse" />
    );
  }

  return (
    <div className="flex items-center gap-4 bg-[#0D1B3D] rounded-2xl px-5 py-4">
      <div className="w-9 h-9 rounded-xl bg-[#009966]/20 flex items-center justify-center shrink-0">
        <Zap className="w-4 h-4 text-[#009966]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-blue-300 font-medium">Current plan</p>
        <p className="text-sm font-black text-white">
          {plan.name}
          {plan.monthly_price_rm > 0
            ? ` — RM ${plan.monthly_price_rm}/month`
            : " — Free forever"}
        </p>
      </div>
      {/* Status pill */}
      {statusPill && (
        <span className={cn(
          "text-[9px] font-bold border px-1.5 py-0.5 rounded-full shrink-0",
          statusPill.color,
        )}>
          {statusPill.label}
        </span>
      )}
      {/* Plan badge */}
      <span className={cn(
        "text-[10px] font-bold border px-2 py-0.5 rounded-full shrink-0",
        badge.color,
      )}>
        {badge.label}
      </span>
    </div>
  );
}

// ─── Individual plan card ─────────────────────────────────────────────────────

interface PlanCardProps {
  slug:        PlanSlug;
  isCurrent:   boolean;
  isLoading:   boolean;
  anyLoading:  boolean;
  onSubscribe: () => void;
}

function PlanCard({ slug, isCurrent, isLoading, anyLoading, onSubscribe }: PlanCardProps) {
  const plan  = PLANS[slug];
  const badge = PLAN_BADGE[slug];
  const isFree = slug === "free";
  const isBoss = slug === "boss";   // highlight as "Most Popular"

  return (
    <div
      className={cn(
        "relative flex flex-col bg-white rounded-2xl border-2 overflow-hidden",
        isCurrent  ? "border-[#009966] shadow-md shadow-emerald-100/50"
        : isBoss   ? "border-[#0D1B3D]"
        : "border-gray-100 shadow-sm",
      )}
    >
      {/* Badges row */}
      <div className="flex items-center gap-2 px-5 pt-4">
        <span className={cn(
          "text-[10px] font-bold border rounded-full px-2 py-0.5",
          badge.color,
        )}>
          {badge.label}
        </span>
        {isBoss && !isCurrent && (
          <span className="flex items-center gap-0.5 text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
            <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
            Popular
          </span>
        )}
        {isCurrent && (
          <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
            ✓ Active
          </span>
        )}
      </div>

      {/* Price */}
      <div className="px-5 pt-3 pb-2">
        <p className="text-xl font-black text-[#0D1B3D]">
          {isFree ? "Free" : `RM ${plan.monthly_price_rm}`}
          {!isFree && (
            <span className="text-xs font-medium text-gray-400 ml-1">/month</span>
          )}
        </p>
        <p className="text-[11px] text-gray-500 mt-0.5">
          {isFree    && "Forever free"}
          {slug === "starter" && "Great for getting started"}
          {slug === "boss"    && "For active debt collection"}
          {slug === "pro"     && "High-volume & teams"}
        </p>
      </div>

      {/* Feature list */}
      <ul className="flex-1 px-5 py-3 flex flex-col gap-2 border-t border-gray-50">
        {FEATURE_ROWS.map((row) => {
          const val = row.getValue(plan);
          const isBoolean = typeof val === "boolean";
          const included  = isBoolean ? val : true;

          return (
            <li key={row.label} className="flex items-center gap-2">
              {isBoolean ? (
                included
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-[#009966] shrink-0" />
                  : <XCircle      className="w-3.5 h-3.5 text-gray-200 shrink-0" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 text-[#009966] shrink-0" />
              )}
              <span className={cn(
                "text-xs",
                isBoolean && !included ? "text-gray-300" : "text-gray-700",
              )}>
                {isBoolean ? row.label : (
                  <><span className="font-semibold text-[#0D1B3D]">{String(val)}</span> {row.label}</>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {/* CTA */}
      <div className="px-5 pb-5 pt-3">
        {isFree || isCurrent ? (
          <div className={cn(
            "w-full py-2.5 rounded-xl text-xs font-bold text-center",
            isCurrent
              ? "bg-emerald-50 text-[#009966] border border-emerald-200"
              : "bg-gray-100 text-gray-400",
          )}>
            {isCurrent ? "✓ Your current plan" : "Always free"}
          </div>
        ) : (
          <button
            onClick={onSubscribe}
            disabled={anyLoading}
            className={cn(
              "w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all",
              isBoss
                ? "bg-[#0D1B3D] hover:bg-[#1a2d5a] text-white"
                : "bg-[#009966] hover:bg-[#00B377] text-white",
              anyLoading && "opacity-60 cursor-not-allowed",
            )}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Redirecting…
              </>
            ) : (
              <>
                Subscribe
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
