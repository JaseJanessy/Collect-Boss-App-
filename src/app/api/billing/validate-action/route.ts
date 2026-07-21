/**
 * POST /api/billing/validate-action
 *
 * Server-side entitlement check before performing a protected action.
 * Called by the frontend just before DB writes to catch limit violations
 * that the client-side state might miss (e.g., race conditions, stale cache).
 *
 * Security:
 *  • Requires authenticated Supabase session
 *  • Reads entitlements and counts from DB server-side — cannot be spoofed
 *  • Does NOT perform the action — just validates permission
 *
 * Request: { action: ValidateAction }
 * Response: { allowed: boolean; reason: string | null; current?: number; limit?: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/server-client";
import type { EntitlementRow } from "@/lib/billing/types";
import { FREE_ENTITLEMENT_MOCK } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";

export type ValidateAction =
  | "create_case"
  | "export_evidence_pack"
  | "use_formal_demand"
  | "use_lawyer_referral"
  | "use_payment_lock"
  | "use_reports"
  | "invite_team_member";

interface ValidateResponse {
  allowed:   boolean;
  reason:    string | null;
  current?:  number;
  limit?:    number;
  planSlug?: string;
}

const err = (msg: string, status = 400) =>
  NextResponse.json({ error: msg }, { status });

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = await getServerClient();
  if (!supabase) return err("Auth service unavailable", 503);

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return err("Authentication required", 401);

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: unknown;
  try { body = await request.json(); } catch { return err("Invalid JSON", 400); }

  const action = (body && typeof body === "object" && "action" in body)
    ? String((body as { action: unknown }).action)
    : "";

  const validActions: ValidateAction[] = [
    "create_case", "export_evidence_pack", "use_formal_demand",
    "use_lawyer_referral", "use_payment_lock", "use_reports", "invite_team_member",
  ];
  if (!validActions.includes(action as ValidateAction)) {
    return err(`Unknown action: "${action}"`, 400);
  }

  // ── Get business_id ───────────────────────────────────────────────────────
  const { data: biz } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();

  const businessId = (biz as { id: string } | null)?.id ?? null;
  if (!businessId) return err("Business not found", 404);

  // ── Get entitlements ──────────────────────────────────────────────────────
  // RLS: owner can SELECT their own entitlements
  const { data: entRow } = await supabase
    .from("entitlements")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();

  const ent: EntitlementRow = (entRow as EntitlementRow | null) ?? FREE_ENTITLEMENT_MOCK;

  // ── Evaluate action ───────────────────────────────────────────────────────
  const result = await evaluateAction(
    action as ValidateAction,
    ent,
    businessId,
    supabase,
  );

  return NextResponse.json(result, { status: 200 });
}

// ─── Per-action evaluation ────────────────────────────────────────────────────

async function evaluateAction(
  action:     ValidateAction,
  ent:        EntitlementRow,
  businessId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase:   any,
): Promise<ValidateResponse> {
  const planSlug = ent.plan_slug;

  switch (action) {
    // ── create_case ──────────────────────────────────────────────────────────
    case "create_case": {
      if (ent.case_limit === -1) {
        return { allowed: true, reason: null, planSlug };
      }
      const { count } = await supabase
        .from("cases")
        .select("*", { count: "exact", head: true })
        .eq("business_id", businessId);

      const current = count ?? 0;
      const limit   = ent.case_limit;

      if (current >= limit) {
        return {
          allowed:  false,
          reason:   `Your current plan allows ${limit} active case${limit === 1 ? "" : "s"}. You have reached your plan limit.`,
          current,
          limit,
          planSlug,
        };
      }
      return { allowed: true, reason: null, current, limit, planSlug };
    }

    // ── export_evidence_pack ─────────────────────────────────────────────────
    case "export_evidence_pack": {
      if (ent.evidence_pack_limit === -1) {
        return { allowed: true, reason: null, planSlug };
      }

      // Count all packs across all cases for this business
      const { data: caseIds } = await supabase
        .from("cases")
        .select("id")
        .eq("business_id", businessId);

      const ids = ((caseIds ?? []) as { id: string }[]).map((c) => c.id);

      let current = 0;
      if (ids.length > 0) {
        const { count } = await supabase
          .from("legal_documents")
          .select("*", { count: "exact", head: true })
          .in("case_id", ids)
          .eq("document_type", "evidence_pack");
        current = count ?? 0;
      }

      const limit = ent.evidence_pack_limit;

      if (current >= limit) {
        return {
          allowed:  false,
          reason:   `Your current plan allows ${limit} evidence pack export${limit === 1 ? "" : "s"}. You have reached your plan limit.`,
          current,
          limit,
          planSlug,
        };
      }
      return { allowed: true, reason: null, current, limit, planSlug };
    }

    // ── use_formal_demand ─────────────────────────────────────────────────────
    case "use_formal_demand": {
      if (!ent.formal_demand_enabled) {
        return {
          allowed:  false,
          reason:   "Formal Demand Letter is not available on your current plan. Upgrade to unlock this feature.",
          planSlug,
        };
      }
      return { allowed: true, reason: null, planSlug };
    }

    // ── use_lawyer_referral ───────────────────────────────────────────────────
    case "use_lawyer_referral": {
      if (!ent.lawyer_referral_enabled) {
        return {
          allowed:  false,
          reason:   "Lawyer Referral is not available on your current plan. Upgrade to unlock this feature.",
          planSlug,
        };
      }
      return { allowed: true, reason: null, planSlug };
    }

    // ── use_payment_lock ──────────────────────────────────────────────────────
    case "use_payment_lock": {
      if (!ent.payment_lock_enabled) {
        return {
          allowed:  false,
          reason:   "Payment Lock (Require Approval) is not available on your current plan. Upgrade to unlock this feature.",
          planSlug,
        };
      }
      return { allowed: true, reason: null, planSlug };
    }

    // ── use_reports ───────────────────────────────────────────────────────────
    case "use_reports": {
      if (!ent.reports_enabled) {
        return {
          allowed:  false,
          reason:   "Full Reports & Analytics is not available on your current plan. Upgrade to unlock this feature.",
          planSlug,
        };
      }
      return { allowed: true, reason: null, planSlug };
    }

    // ── invite_team_member ────────────────────────────────────────────────────
    case "invite_team_member": {
      // Team member invites not built yet — enforce limit for future use
      const limit = ent.team_member_limit;
      // For now: current team members = 1 (owner only)
      const current = 1;
      if (current >= limit) {
        return {
          allowed:  false,
          reason:   `Your current plan allows ${limit} team member${limit === 1 ? "" : "s"}. Upgrade to add more.`,
          current,
          limit,
          planSlug,
        };
      }
      return { allowed: true, reason: null, current, limit, planSlug };
    }

    default:
      return { allowed: false, reason: "Unknown action", planSlug };
  }
}
