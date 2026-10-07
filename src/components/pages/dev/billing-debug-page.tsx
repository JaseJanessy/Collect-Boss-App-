"use client";

/**
 * BillingDebugPage — developer tool for verifying billing state.
 * Only rendered in non-production environments.
 */

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useEntitlements } from "@/hooks/use-entitlements";
import { useSubscription } from "@/hooks/use-subscription";
import { useAuth } from "@/hooks/use-auth";
import { PLANS } from "@/lib/billing/plans";
import { CheckCircle2, XCircle, RefreshCw, Copy, Check, AlertTriangle, Terminal } from "lucide-react";

// ─── Env status (only checks NEXT_PUBLIC_ vars — never reveals secret values) ─

function EnvRow({ label, envKey, value }: { label: string; envKey: string; value: string | undefined }) {
  const present = !!value && value.length > 4;
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
      <div className="min-w-0">
        <p className="text-xs font-mono text-gray-700">{envKey}</p>
        <p className="text-[11px] text-gray-400">{label}</p>
      </div>
      {present ? (
        <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-700">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          Set ({value!.slice(0, 8)}…)
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-[10px] font-bold text-red-600">
          <XCircle className="w-3.5 h-3.5 text-red-400" />
          Missing
        </div>
      )}
    </div>
  );
}

// ─── Copy-to-clipboard helper ─────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button onClick={copy} className="p-1 hover:bg-gray-100 rounded transition-colors">
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-gray-400" />}
    </button>
  );
}

// ─── Code block ───────────────────────────────────────────────────────────────

function CodeBlock({ children }: { children: string }) {
  return (
    <div className="relative bg-[#0D1B3D] rounded-xl p-4 overflow-x-auto">
      <pre className="text-[11px] text-blue-200 font-mono leading-relaxed whitespace-pre-wrap break-all">
        {children}
      </pre>
      <div className="absolute top-2 right-2">
        <CopyButton text={children} />
      </div>
    </div>
  );
}

// ─── Feature flag row ─────────────────────────────────────────────────────────

function FlagRow({ label, value }: { label: string; value: boolean | string | number }) {
  const isBool = typeof value === "boolean";
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-600">{label}</span>
      {isBool ? (
        value
          ? <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Enabled</span>
          : <span className="text-[10px] font-bold text-red-500 flex items-center gap-1"><XCircle className="w-3 h-3" /> Locked</span>
      ) : (
        <span className="text-xs font-bold text-gray-800">
          {value === -1 ? "Unlimited" : String(value)}
        </span>
      )}
    </div>
  );
}

// ─── Section card ─────────────────────────────────────────────────────────────

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden", className)}>
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
        <p className="text-xs font-black text-gray-700 uppercase tracking-wide">{title}</p>
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function BillingDebugPage() {
  const { user }                                     = useAuth();
  const { entitlement, flags, loading: entLoading }  = useEntitlements();
  const { subscription, loading: subLoading, refresh } = useSubscription();

  const plan = entitlement ? PLANS[entitlement.plan_slug] ?? PLANS.free : PLANS.free;

  // Public env vars only — secrets never exposed
  const envVars = [
    { label: "App URL",              envKey: "NEXT_PUBLIC_APP_URL",                   value: process.env.NEXT_PUBLIC_APP_URL },
    { label: "App Environment",      envKey: "NEXT_PUBLIC_APP_ENV",                   value: process.env.NEXT_PUBLIC_APP_ENV },
    { label: "Supabase URL",         envKey: "NEXT_PUBLIC_SUPABASE_URL",              value: process.env.NEXT_PUBLIC_SUPABASE_URL },
    { label: "Supabase Anon Key",    envKey: "NEXT_PUBLIC_SUPABASE_ANON_KEY",         value: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
    { label: "Stripe Publishable",   envKey: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",    value: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY },
  ];

  // Secret key status is checked server-side — we only get a boolean flag here
  const isStripeConfigured = !!(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);

  return (
    <div className="min-h-screen bg-[#F2F4F7] px-4 py-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Terminal className="w-5 h-5 text-[#009966]" />
            <h1 className="text-lg font-black text-[#0D1B3D]">Billing Debug</h1>
          </div>
          <p className="text-xs text-gray-500">Development tool — not available in production</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            className="flex items-center gap-1.5 text-xs font-bold text-gray-600 bg-white border border-gray-200 px-3 py-1.5 rounded-xl hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <Link href="/billing" className="text-xs font-bold text-[#009966] bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl hover:bg-emerald-100 transition-colors">
            → Billing Page
          </Link>
        </div>
      </div>

      {/* Warning banner */}
      <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6">
        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <p className="text-[11px] text-amber-800 leading-relaxed">
          <strong>Dev only.</strong> This page is blocked in production.
          Never commit real Stripe or Supabase secrets. See{" "}
          <code className="font-mono bg-amber-100 px-1 rounded">docs/STRIPE_TEST_MODE_SETUP.md</code> for setup instructions.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {/* Auth state */}
        <Section title="Auth State">
          {user ? (
            <div className="flex flex-col gap-1">
              <FlagRow label="User ID"    value={user.id ?? "—"} />
              <FlagRow label="Email"      value="[redacted — check auth session]" />
              <FlagRow label="Name"       value={user.name ?? "—"} />
            </div>
          ) : (
            <p className="text-xs text-red-500">Not authenticated — <Link href="/login" className="font-bold underline">Log in</Link></p>
          )}
        </Section>

        {/* Env var status */}
        <Section title="Environment Variables (NEXT_PUBLIC_ only)">
          {envVars.map((v) => (
            <EnvRow key={v.envKey} {...v} />
          ))}
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-[10px] text-gray-400">
              Server-side secrets (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY)
              are checked at request time and never exposed to the browser.
              Visit{" "}
              <Link href="/api/billing/validate-action" className="text-[#009966] underline" target="_blank">
                /api/billing/validate-action
              </Link>{" "}
              to verify server-side config.
            </p>
          </div>
        </Section>

        {/* Subscription */}
        <Section title="Subscription Row">
          {subLoading ? (
            <p className="text-xs text-gray-400">Loading…</p>
          ) : subscription ? (
            <div className="flex flex-col gap-1">
              <FlagRow label="plan_slug"              value={subscription.plan_slug} />
              <FlagRow label="status"                 value={subscription.status} />
              <FlagRow label="stripe_customer_id"     value={subscription.stripe_customer_id ? "[present — redacted]" : "null"} />
              <FlagRow label="stripe_subscription_id" value={subscription.stripe_subscription_id ? "[present — redacted]" : "null"} />
              <FlagRow label="cancel_at_period_end"   value={subscription.cancel_at_period_end} />
              <FlagRow label="current_period_end"     value={subscription.current_period_end ?? "null"} />
            </div>
          ) : (
            <p className="text-xs text-gray-400">No subscription row found (expected: free plan row from trigger)</p>
          )}
        </Section>

        {/* Entitlement */}
        <Section title="Entitlements Row">
          {entLoading ? (
            <p className="text-xs text-gray-400">Loading…</p>
          ) : entitlement ? (
            <div className="flex flex-col gap-1">
              <FlagRow label="plan_slug"               value={entitlement.plan_slug} />
              <FlagRow label="case_limit"              value={entitlement.case_limit} />
              <FlagRow label="evidence_pack_limit"     value={entitlement.evidence_pack_limit} />
              <FlagRow label="team_member_limit"       value={entitlement.team_member_limit} />
              <FlagRow label="payment_lock_enabled"    value={entitlement.payment_lock_enabled} />
              <FlagRow label="formal_demand_enabled"   value={entitlement.formal_demand_enabled} />
              <FlagRow label="lawyer_referral_enabled" value={entitlement.lawyer_referral_enabled} />
              <FlagRow label="reports_enabled"         value={entitlement.reports_enabled} />
              <div className="pt-1 text-[10px] text-gray-400">
                Updated: {entitlement.updated_at}
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400">No entitlement row (run billing.sql migration)</p>
          )}
        </Section>

        {/* Feature flags */}
        <Section title="Feature Flags (derived from entitlements)">
          {entLoading ? (
            <p className="text-xs text-gray-400">Loading…</p>
          ) : (
            <div className="flex flex-col gap-1">
              <FlagRow label="canCreateCase(0)"      value={flags.canCreateCase(0)} />
              <FlagRow label="canCreateCase(limit)"  value={flags.canCreateCase(entitlement?.case_limit ?? PLANS.free.case_limit)} />
              <FlagRow label="canExportEvidencePack(0)" value={flags.canExportEvidencePack(0)} />
              <FlagRow label="canUsePaymentLock"     value={flags.canUsePaymentLock} />
              <FlagRow label="canUseFormalDemand"    value={flags.canUseFormalDemand} />
              <FlagRow label="canUseLawyerReferral"  value={flags.canUseLawyerReferral} />
              <FlagRow label="canViewReports"        value={flags.canViewReports} />
            </div>
          )}
        </Section>

        {/* Plan comparison */}
        <Section title="Expected Entitlements for Current Plan">
          <div className="flex flex-col gap-1">
            <FlagRow label="Plan name"          value={plan.name} />
            <FlagRow label="Expected case_limit" value={plan.case_limit} />
            <FlagRow label="Expected ev_pack_limit" value={plan.evidence_pack_limit} />
            <FlagRow label="Expected payment_lock" value={plan.payment_lock_enabled} />
            <FlagRow label="Expected formal_demand" value={plan.formal_demand_enabled} />
          </div>
          {entitlement && plan.case_limit !== entitlement.case_limit && (
            <div className="mt-2 flex items-center gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              <XCircle className="w-3.5 h-3.5 text-red-500" />
              <p className="text-[10px] text-red-700 font-bold">
                Mismatch! Entitlement does not match plan. Webhook may not have fired.
              </p>
            </div>
          )}
        </Section>

        {/* Quick actions */}
        <Section title="Quick Test Actions">
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "→ Billing Page",     href: "/billing" },
              { label: "→ Add Case",         href: "/add" },
              { label: "→ Reports",          href: "/reports" },
              { label: "→ Public Landing",   href: "/landing" },
            ].map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="flex items-center justify-center py-2 text-xs font-semibold text-[#0D1B3D] bg-[#F2F4F7] hover:bg-gray-200 rounded-xl transition-colors"
              >
                {a.label}
              </Link>
            ))}
          </div>
        </Section>

        {/* Stripe CLI commands */}
        <Section title="Stripe CLI Commands">
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-[11px] font-bold text-gray-600 mb-1">Start webhook forwarding</p>
              <CodeBlock>stripe listen --forward-to localhost:3000/api/stripe/webhook</CodeBlock>
            </div>
            <div>
              <p className="text-[11px] font-bold text-gray-600 mb-1">Trigger subscription events</p>
              <CodeBlock>{[
                "stripe trigger checkout.session.completed",
                "stripe trigger customer.subscription.updated",
                "stripe trigger customer.subscription.deleted",
                "stripe trigger invoice.payment_succeeded",
                "stripe trigger invoice.payment_failed",
              ].join("\n")}</CodeBlock>
            </div>
            <div>
              <p className="text-[11px] font-bold text-gray-600 mb-1">Check secret key status (server-side)</p>
              <CodeBlock>{`curl -X POST ${process.env.NEXT_PUBLIC_APP_URL ?? (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : "[missing NEXT_PUBLIC_APP_URL]")}/api/billing/validate-action \\
  -H "Content-Type: application/json" \\
  -d '{"action": "create_case"}' \\
  -b "[paste session cookie here]"`}</CodeBlock>
            </div>
            <div>
              <p className="text-[11px] font-bold text-gray-600 mb-1">Verify no secrets in client bundle</p>
              <CodeBlock>{`grep -r "sk_test_\\|sk_live_\\|whsec_" .next/static/ 2>/dev/null || echo "✓ No secrets found"`}</CodeBlock>
            </div>
          </div>
        </Section>

        {/* DB verification */}
        <Section title="Supabase SQL Verification Queries">
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-[11px] font-bold text-gray-600 mb-1">Check latest subscription</p>
              <CodeBlock>SELECT plan_slug, status, cancel_at_period_end, updated_at
FROM subscriptions
ORDER BY updated_at DESC LIMIT 5;</CodeBlock>
            </div>
            <div>
              <p className="text-[11px] font-bold text-gray-600 mb-1">Check entitlements</p>
              <CodeBlock>SELECT plan_slug, case_limit, payment_lock_enabled,
       formal_demand_enabled, reports_enabled, updated_at
FROM entitlements
ORDER BY updated_at DESC LIMIT 5;</CodeBlock>
            </div>
            <div>
              <p className="text-[11px] font-bold text-gray-600 mb-1">Check recent billing events</p>
              <CodeBlock>SELECT stripe_event_id, event_type, processed, created_at
FROM billing_events
ORDER BY created_at DESC LIMIT 20;</CodeBlock>
            </div>
          </div>
        </Section>

        {/* Links to docs */}
        <Section title="Documentation">
          <div className="flex flex-col gap-2 text-xs">
            <a
              href="https://github.com/your-repo/blob/main/docs/BILLING_QA.md"
              className="text-[#009966] hover:underline font-semibold"
              target="_blank"
            >
              📋 docs/BILLING_QA.md — Full QA checklist
            </a>
            <a
              href="https://github.com/your-repo/blob/main/docs/STRIPE_TEST_MODE_SETUP.md"
              className="text-[#009966] hover:underline font-semibold"
              target="_blank"
            >
              🔧 docs/STRIPE_TEST_MODE_SETUP.md — Setup guide
            </a>
            <a
              href="https://stripe.com/docs/testing"
              className="text-[#009966] hover:underline font-semibold"
              target="_blank"
            >
              🧪 Stripe test cards — stripe.com/docs/testing
            </a>
          </div>
        </Section>

        {isStripeConfigured && (
          <div className="text-center">
            <p className="text-[10px] text-gray-300 font-mono">
              Stripe publishable key detected · Secret key status unknown (server-side only)
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
