/**
 * CollectBoss plan definitions — single source of truth for the client side.
 * Mirrors the seed data in supabase/billing.sql.
 * stripe_price_id is set to null until Stripe Checkout is wired.
 */

import type { PlanRow, PlanSlug } from "./types";

// ─── Static plan catalogue ────────────────────────────────────────────────────

export const PLANS: Record<PlanSlug, PlanRow> = {
  free: {
    id:                      "plan-free",
    name:                    "Free",
    slug:                    "free",
    monthly_price_rm:        0,
    stripe_price_id:         null,
    case_limit:              3,
    evidence_pack_limit:     1,
    team_member_limit:       1,
    payment_lock_enabled:    false,
    formal_demand_enabled:   false,
    lawyer_referral_enabled: false,
    reports_enabled:         false,
    created_at:              "2024-01-01T00:00:00Z",
  },

  starter: {
    id:                      "plan-starter",
    name:                    "Starter",
    slug:                    "starter",
    monthly_price_rm:        19,
    stripe_price_id:         null,
    case_limit:              20,
    evidence_pack_limit:     5,
    team_member_limit:       1,
    payment_lock_enabled:    true,
    formal_demand_enabled:   false,
    lawyer_referral_enabled: false,
    reports_enabled:         false,
    created_at:              "2024-01-01T00:00:00Z",
  },

  boss: {
    id:                      "plan-boss",
    name:                    "Boss",
    slug:                    "boss",
    monthly_price_rm:        49,
    stripe_price_id:         null,
    case_limit:              -1,   // unlimited
    evidence_pack_limit:     -1,   // unlimited
    team_member_limit:       3,
    payment_lock_enabled:    true,
    formal_demand_enabled:   true,
    lawyer_referral_enabled: true,
    reports_enabled:         true,
    created_at:              "2024-01-01T00:00:00Z",
  },

  pro: {
    id:                      "plan-pro",
    name:                    "Pro",
    slug:                    "pro",
    monthly_price_rm:        99,
    stripe_price_id:         null,
    case_limit:              -1,   // unlimited
    evidence_pack_limit:     -1,   // unlimited
    team_member_limit:       10,
    payment_lock_enabled:    true,
    formal_demand_enabled:   true,
    lawyer_referral_enabled: true,
    reports_enabled:         true,
    created_at:              "2024-01-01T00:00:00Z",
  },
};

// Ordered for display (cheapest → most expensive)
export const PLAN_ORDER: PlanSlug[] = ["free", "starter", "boss", "pro"];

export const PLAN_MARKETING: Record<PlanSlug, {
  description: string;
  badge: string | null;
  primary: boolean;
  color: string;
  cta: string;
}> = {
  free: { description: "For SMEs just getting started.", badge: null, primary: false, color: "border-gray-200", cta: "Start Free" },
  starter: { description: "For SMEs actively managing overdue accounts.", badge: "Most Popular", primary: true, color: "border-[#009966]", cta: "Start Starter" },
  boss: { description: "For established recovery workflows and small teams.", badge: null, primary: false, color: "border-[#0D1B3D]", cta: "Choose Boss" },
  pro: { description: "For larger teams needing the highest member limit.", badge: null, primary: false, color: "border-indigo-300", cta: "Choose Pro" },
};

export function planFeatureLabels(plan: PlanRow): string[] {
  const limit = (value: number, singular: string, plural: string) => value === -1 ? `Unlimited ${plural}` : `Up to ${value} ${value === 1 ? singular : plural}`;
  return [
    limit(plan.case_limit, "active case", "active cases"),
    limit(plan.evidence_pack_limit, "evidence pack export", "evidence pack exports"),
    limit(plan.team_member_limit, "team member", "team members"),
    plan.payment_lock_enabled ? "Payment Lock and proof review" : "Core payment tracking",
    plan.formal_demand_enabled ? "Formal payment reminder drafts" : "Reminder generator",
    plan.reports_enabled ? "Operational reports" : "Core case summaries",
  ];
}

// ─── Display helpers ──────────────────────────────────────────────────────────

export const PLAN_BADGE: Record<PlanSlug, { label: string; color: string }> = {
  free:    { label: "Free",    color: "bg-gray-100 text-gray-600 border-gray-200" },
  starter: { label: "Starter", color: "bg-blue-50 text-blue-700 border-blue-200" },
  boss:    { label: "Boss",    color: "bg-emerald-50 text-[#009966] border-emerald-200" },
  pro:     { label: "Pro",     color: "bg-[#0D1B3D] text-white border-[#0D1B3D]" },
};

/** Format case / pack limits for display. -1 → "Unlimited" */
export function formatLimit(n: number): string {
  return n === -1 ? "Unlimited" : String(n);
}

/** Format monthly price. 0 → "Free" */
export function formatPlanPrice(rm: number): string {
  return rm === 0 ? "Free" : `RM ${rm}/mo`;
}

// ─── Default free entitlement (used when Supabase is not configured) ──────────

export const FREE_ENTITLEMENT_MOCK = {
  id:                      "ent-mock-free",
  business_id:             "mock-business-id",
  plan_slug:               "free" as PlanSlug,
  case_limit:              3,
  evidence_pack_limit:     1,
  team_member_limit:       1,
  payment_lock_enabled:    false,
  formal_demand_enabled:   false,
  lawyer_referral_enabled: false,
  reports_enabled:         false,
  updated_at:              new Date().toISOString(),
};
