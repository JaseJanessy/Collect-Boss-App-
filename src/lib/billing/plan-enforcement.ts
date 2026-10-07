/**
 * Server-side plan enforcement.
 *
 * Single source of truth for plan limits and feature gates. Used both by the
 * advisory POST /api/billing/validate-action endpoint and by the write
 * endpoints themselves, so a client cannot skip the check by calling the API
 * directly.
 *
 * Fails closed: if entitlements or usage counts cannot be read, the action is
 * refused with `unavailable: true` instead of being allowed.
 */

import "server-only";

import { NextResponse } from "next/server";
import type { AppSupabaseClient } from "@/lib/supabase/client";
import type { EntitlementRow, PlanSlug } from "./types";
import { FREE_ENTITLEMENT_MOCK, PLANS } from "./plans";
import { canAddTeamMember, teamSeatLimitMessage, teamSeatsUsed } from "./team-seats";

export type PlanAction =
  | "create_case"
  | "export_evidence_pack"
  | "use_formal_demand"
  | "use_lawyer_referral"
  | "use_payment_lock"
  | "use_reports"
  | "invite_team_member";

export const PLAN_ACTIONS: readonly PlanAction[] = [
  "create_case", "export_evidence_pack", "use_formal_demand",
  "use_lawyer_referral", "use_payment_lock", "use_reports", "invite_team_member",
];

export interface PlanCheckResult {
  allowed:      boolean;
  reason:       string | null;
  current?:     number;
  limit?:       number;
  planSlug?:    string;
  /** True when the check itself could not run; callers should answer 503. */
  unavailable?: boolean;
}

const UNAVAILABLE: PlanCheckResult = {
  allowed: false,
  reason: "We couldn't check your plan right now. Please try again.",
  unavailable: true,
};

/** Loads the business entitlement row. A missing row means the Free plan. */
async function loadEntitlement(client: AppSupabaseClient, businessId: string): Promise<EntitlementRow | null> {
  const { data, error } = await client
    .from("entitlements")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) return null;
  return (data as EntitlementRow | null) ?? FREE_ENTITLEMENT_MOCK;
}

export async function checkPlanAction(
  client: AppSupabaseClient,
  businessId: string,
  action: PlanAction,
): Promise<PlanCheckResult> {
  const ent = await loadEntitlement(client, businessId);
  if (!ent) return UNAVAILABLE;
  const planSlug = ent.plan_slug;

  switch (action) {
    case "create_case": {
      if (ent.case_limit === -1) return { allowed: true, reason: null, planSlug };
      // Plans are sold as "active cases": closed and archived cases do not count.
      const { count, error } = await client
        .from("cases")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .is("archived_at", null)
        .neq("status", "closed");
      if (error) return UNAVAILABLE;
      const current = count ?? 0;
      const limit = ent.case_limit;
      if (current >= limit) {
        return {
          allowed: false,
          reason: `Your current plan allows ${limit} active case${limit === 1 ? "" : "s"}. You have reached your plan limit.`,
          current, limit, planSlug,
        };
      }
      return { allowed: true, reason: null, current, limit, planSlug };
    }

    case "export_evidence_pack": {
      if (ent.evidence_pack_limit === -1) return { allowed: true, reason: null, planSlug };
      const { data: caseIds, error: casesError } = await client
        .from("cases")
        .select("id")
        .eq("business_id", businessId);
      if (casesError) return UNAVAILABLE;
      const ids = ((caseIds ?? []) as { id: string }[]).map((c) => c.id);
      let current = 0;
      if (ids.length > 0) {
        const { count, error } = await client
          .from("legal_documents")
          .select("id", { count: "exact", head: true })
          .in("case_id", ids)
          .eq("document_type", "evidence_pack");
        if (error) return UNAVAILABLE;
        current = count ?? 0;
      }
      const limit = ent.evidence_pack_limit;
      if (current >= limit) {
        return {
          allowed: false,
          reason: `Your current plan allows ${limit} evidence pack export${limit === 1 ? "" : "s"}. You have reached your plan limit.`,
          current, limit, planSlug,
        };
      }
      return { allowed: true, reason: null, current, limit, planSlug };
    }

    case "use_formal_demand":
      return ent.formal_demand_enabled
        ? { allowed: true, reason: null, planSlug }
        : { allowed: false, reason: "Formal Payment Notice is not available on your current plan. Upgrade to unlock this feature.", planSlug };

    case "use_lawyer_referral":
      return ent.lawyer_referral_enabled
        ? { allowed: true, reason: null, planSlug }
        : { allowed: false, reason: "Request Legal Review is not available on your current plan. Upgrade to unlock this feature.", planSlug };

    case "use_payment_lock":
      return ent.payment_lock_enabled
        ? { allowed: true, reason: null, planSlug }
        : { allowed: false, reason: "Payment Lock (Require Approval) is not available on your current plan. Upgrade to unlock this feature.", planSlug };

    case "use_reports":
      return ent.reports_enabled
        ? { allowed: true, reason: null, planSlug }
        : { allowed: false, reason: "Full Reports & Analytics is not available on your current plan. Upgrade to unlock this feature.", planSlug };

    case "invite_team_member": {
      // Same seat rule as the invite API: owner + active/invited members.
      const limit = ent.team_member_limit;
      const { count, error } = await client
        .from("business_memberships")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .in("status", ["active", "invited"])
        .neq("role", "owner");
      if (error) return UNAVAILABLE;
      const current = teamSeatsUsed(count ?? 0);
      if (!canAddTeamMember({ used: current, limit })) {
        return {
          allowed: false,
          reason: teamSeatLimitMessage({ limit, extraSeats: 0 }, PLANS[planSlug as PlanSlug]?.name ?? "current"),
          current, limit, planSlug,
        };
      }
      return { allowed: true, reason: null, current, limit, planSlug };
    }
  }
}

/**
 * Returns a ready-to-send error response when the action is not allowed, or
 * null when the caller may proceed.
 */
export async function planActionDenial(
  client: AppSupabaseClient,
  businessId: string,
  action: PlanAction,
): Promise<NextResponse | null> {
  const result = await checkPlanAction(client, businessId, action);
  if (result.allowed) return null;
  return NextResponse.json(
    {
      error: result.reason,
      code: result.unavailable ? "PLAN_CHECK_UNAVAILABLE" : "PLAN_LIMIT_REACHED",
      ...(result.current !== undefined ? { current: result.current } : {}),
      ...(result.limit !== undefined ? { limit: result.limit } : {}),
    },
    { status: result.unavailable ? 503 : 403, headers: { "Cache-Control": "no-store" } },
  );
}
