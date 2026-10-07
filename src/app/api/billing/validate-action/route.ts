/**
 * POST /api/billing/validate-action
 *
 * Server-side entitlement check before performing a protected action.
 * Called by the frontend just before DB writes to catch limit violations
 * that the client-side state might miss (e.g., race conditions, stale cache).
 * The write endpoints enforce the same rules themselves via
 * `@/lib/billing/plan-enforcement`; this endpoint only lets the UI explain a
 * refusal before the user fills in a form.
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
import { requireTenantPermission } from "@/lib/auth/tenant-access";
import type { TenantPermission } from "@/lib/auth/permissions";
import { checkPlanAction, PLAN_ACTIONS, type PlanAction } from "@/lib/billing/plan-enforcement";

export const dynamic = "force-dynamic";

export type ValidateAction = PlanAction;

const err = (msg: string, status = 400) =>
  NextResponse.json({ error: msg }, { status });

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── Parse body ────────────────────────────────────────────────────────────
  let body: unknown;
  try { body = await request.json(); } catch { return err("Invalid JSON", 400); }

  const action = (body && typeof body === "object" && "action" in body)
    ? String((body as { action: unknown }).action)
    : "";

  if (!PLAN_ACTIONS.includes(action as ValidateAction)) {
    return err(`Unknown action: "${action}"`, 400);
  }

  // ── Get business_id ───────────────────────────────────────────────────────
  const permissionByAction: Record<ValidateAction, TenantPermission> = {
    create_case: "case.manage",
    export_evidence_pack: "export.run",
    use_formal_demand: "case.manage",
    use_lawyer_referral: "case.manage",
    use_payment_lock: "case.manage",
    use_reports: "report.read",
    invite_team_member: "users.manage",
  };
  const access = await requireTenantPermission(permissionByAction[action as ValidateAction]);
  if ("error" in access) return err(access.error ?? "Action access denied.", access.status ?? 403);

  const { unavailable, ...result } = await checkPlanAction(access.client, access.businessId, action as ValidateAction);
  if (unavailable) return err(result.reason ?? "Plan check unavailable.", 503);
  return NextResponse.json(result, { status: 200 });
}
