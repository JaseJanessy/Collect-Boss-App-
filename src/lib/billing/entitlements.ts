/**
 * Entitlement helpers — pure functions that evaluate what a business is
 * allowed to do based on their EntitlementRow.
 *
 * All functions are pure (no network calls) so they can be used safely in
 * both server and client contexts.
 *
 * -1 in a *_limit field means unlimited.
 */

import type { EntitlementRow, EntitlementFlags } from "./types";
import { FREE_ENTITLEMENT_MOCK } from "./plans";

// ─── Limit check ──────────────────────────────────────────────────────────────

/** Returns true if `current` is below the limit (-1 = unlimited). */
function withinLimit(limit: number, current: number): boolean {
  if (limit === -1) return true;          // unlimited
  return current < limit;
}

// ─── Individual checks ────────────────────────────────────────────────────────

/**
 * Can the business create one more case?
 * @param ent         Current entitlement row.
 * @param currentCount How many active cases the business already has.
 */
export function canCreateCase(
  ent: EntitlementRow,
  currentCount: number,
): boolean {
  return withinLimit(ent.case_limit, currentCount);
}

/**
 * Can the business export one more evidence pack this period?
 * @param ent         Current entitlement row.
 * @param currentCount How many packs have been generated this period.
 */
export function canExportEvidencePack(
  ent: EntitlementRow,
  currentCount: number,
): boolean {
  return withinLimit(ent.evidence_pack_limit, currentCount);
}

/** Can the business use Payment Lock on any case? */
export function canUsePaymentLock(ent: EntitlementRow): boolean {
  return ent.payment_lock_enabled;
}

/** Can the business generate a formal demand letter? */
export function canUseFormalDemand(ent: EntitlementRow): boolean {
  return ent.formal_demand_enabled;
}

/** Can the business use lawyer referral features? */
export function canUseLawyerReferral(ent: EntitlementRow): boolean {
  return ent.lawyer_referral_enabled;
}

/** Can the business access the full Reports & Analytics page? */
export function canViewReports(ent: EntitlementRow): boolean {
  return ent.reports_enabled;
}

// ─── Bundle helper ────────────────────────────────────────────────────────────

/**
 * Derive all flags from a single EntitlementRow.
 * Useful where you want to pass one object around rather than calling
 * individual helpers.
 *
 * @example
 * const flags = getEntitlementFlags(ent);
 * if (!flags.canCreateCase(caseCount)) showUpgradePrompt();
 */
export function getEntitlementFlags(ent: EntitlementRow): EntitlementFlags {
  return {
    canCreateCase:         (n: number) => canCreateCase(ent, n),
    canExportEvidencePack: (n: number) => canExportEvidencePack(ent, n),
    canUsePaymentLock:     canUsePaymentLock(ent),
    canUseFormalDemand:    canUseFormalDemand(ent),
    canUseLawyerReferral:  canUseLawyerReferral(ent),
    canViewReports:        canViewReports(ent),
  };
}

// ─── Upgrade prompt helpers ───────────────────────────────────────────────────

export interface LimitReason {
  blocked:       boolean;
  reason:        string;
  upgradePrompt: string;
}

/** Returns a human-readable block reason for case creation, or unblocked. */
export function caseLimitReason(
  ent: EntitlementRow,
  currentCount: number,
): LimitReason {
  if (canCreateCase(ent, currentCount)) {
    return { blocked: false, reason: "", upgradePrompt: "" };
  }
  const remaining = ent.case_limit;
  return {
    blocked:       true,
    reason:        `You have reached the ${remaining}-case limit for the ${ent.plan_slug} plan.`,
    upgradePrompt: "Upgrade your plan to create more cases.",
  };
}

/** Returns a human-readable block reason for evidence pack export. */
export function evidencePackLimitReason(
  ent: EntitlementRow,
  currentCount: number,
): LimitReason {
  if (canExportEvidencePack(ent, currentCount)) {
    return { blocked: false, reason: "", upgradePrompt: "" };
  }
  return {
    blocked:       true,
    reason:        `You have used all ${ent.evidence_pack_limit} evidence pack export(s) on the ${ent.plan_slug} plan.`,
    upgradePrompt: "Upgrade your plan to export more evidence packs.",
  };
}

/** Returns a human-readable block reason for a feature flag. */
export function featureBlockReason(
  feature: "payment_lock" | "formal_demand" | "lawyer_referral" | "reports",
  planSlug: string,
): LimitReason {
  const labels: Record<string, string> = {
    payment_lock:     "Payment Lock",
    formal_demand:    "Formal Demand Letter",
    lawyer_referral:  "Lawyer Referral",
    reports:          "Reports & Analytics",
  };
  return {
    blocked:       true,
    reason:        `${labels[feature]} is not available on the ${planSlug} plan.`,
    upgradePrompt: `Upgrade your plan to use ${labels[feature]}.`,
  };
}

// ─── Fallback (no Supabase / mock mode) ──────────────────────────────────────

/**
 * Returns mock free-tier entitlement flags.
 * Used as a fallback when Supabase is not configured.
 */
export function getMockEntitlementFlags(): EntitlementFlags {
  return getEntitlementFlags(FREE_ENTITLEMENT_MOCK);
}
