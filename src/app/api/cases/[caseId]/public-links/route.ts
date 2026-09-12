import { NextRequest, NextResponse } from "next/server";
import { appendSensitiveAudit, requireTenantPermission } from "@/lib/auth/tenant-access";
import { getAppUrl } from "@/lib/app-url";
import {
  generatePublicToken,
  hashPublicToken,
  type PublicAccessPurpose,
} from "@/lib/public-access/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ caseId: string }> },
) {
  const access = await requireTenantPermission("public_link.manage");
  if ("error" in access) return json({ error: access.error }, access.status);
  const { caseId } = await context.params;
  const { data: caseScope } = await access.service.from("cases")
    .select("id,business_id,currency").eq("id", caseId).eq("business_id", access.businessId).maybeSingle();
  if (!caseScope) return json({ error: "Case not found." }, 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid link request." }, 400);
  }
  const input = body as { purpose?: unknown; paymentPlanId?: unknown; expiresInHours?: unknown };
  const purpose = input.purpose;
  if (purpose !== "payment" && purpose !== "acknowledgement") {
    return json({ error: "Choose a valid public-link purpose." }, 400);
  }

  const hours = typeof input.expiresInHours === "number" ? input.expiresInHours : 168;
  if (!Number.isInteger(hours) || hours < 1 || hours > 24 * 30) {
    return json({ error: "Expiry must be between one hour and 30 days." }, 400);
  }

  const service = access.service;

  const { data: paymentCase } = await service
    .from("cases")
    .select("status, archived_at, payment_lock_mode, receiving_account_id")
    .eq("id", caseScope.id)
    .maybeSingle();
  if (!paymentCase || (paymentCase as { status: string }).status === "closed" || (paymentCase as { archived_at: string | null }).archived_at) {
    return json({ error: "Closed or archived cases cannot issue public payment links." }, 409);
  }
  if (purpose === "payment" && (paymentCase as { payment_lock_mode: string }).payment_lock_mode === "manual") {
    return json({ error: "Manual payment access does not issue public payment links." }, 409);
  }

  let paymentPlanId: string | null = null;
  if (purpose === "acknowledgement") {
    if (typeof input.paymentPlanId !== "string") {
      return json({ error: "A payment plan is required for acknowledgement links." }, 400);
    }
    const { data: plan } = await service
      .from("payment_plans")
      .select("id, status, terms_snapshot")
      .eq("id", input.paymentPlanId)
      .eq("case_id", caseScope.id)
      .maybeSingle();
    if (!plan) return json({ error: "Payment plan not found." }, 404);
    if ((plan as { status: string }).status !== "pending_acceptance" ||
      !(plan as { terms_snapshot: unknown }).terms_snapshot ||
      JSON.stringify((plan as { terms_snapshot: unknown }).terms_snapshot) === "{}") {
      return json({ error: "Only an immutable payment-plan proposal can receive an acknowledgement link." }, 409);
    }
    paymentPlanId = input.paymentPlanId;

    // A replacement acknowledgement link supersedes any earlier active link.
    await service
      .from("public_access_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("purpose", "acknowledgement")
      .eq("payment_plan_id", paymentPlanId)
      .is("revoked_at", null)
      .is("consumed_at", null);
  }

  const rawToken = generatePublicToken();
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  let receivingAccountId: string | null = null;
  if (purpose === "payment") {
    const { data: access, error: accessError } = await service.rpc("business_payment_link_access", {
      p_business_id: caseScope.business_id,
    });
    if (accessError) return json({ error: "Unable to verify payment-link eligibility." }, 503);
    const paymentLinkAccess = access as { allowed?: boolean; reason?: string };
    if (!paymentLinkAccess.allowed) {
      const message = paymentLinkAccess.reason === "additional_review_required"
        ? "Business verification review is required before payment links can be enabled for this industry."
        : "Payment links are temporarily unavailable while a safety review is active.";
      return json({ error: message, restrictionReason: paymentLinkAccess.reason }, 409);
    }
    receivingAccountId = (paymentCase as { receiving_account_id: string | null }).receiving_account_id;
    if (receivingAccountId) {
      const { data: selected } = await service.from("receiving_accounts").select("id").eq("id", receivingAccountId).eq("business_id", caseScope.business_id).eq("currency", caseScope.currency).eq("is_active", true).eq("verification_status", "verified").maybeSingle();
      if (!selected) receivingAccountId = null;
    }
    if (!receivingAccountId) {
      const { data: primary } = await service.from("receiving_accounts").select("id").eq("business_id", caseScope.business_id).eq("currency", caseScope.currency).eq("is_primary", true).eq("is_active", true).eq("verification_status", "verified").maybeSingle();
      receivingAccountId = (primary as { id: string } | null)?.id ?? null;
    }
    if (!receivingAccountId) return json({ error: "Choose a receiving account before creating a payment link." }, 409);
  }
  const { error: insertError } = await service.from("public_access_tokens").insert({
    token_hash: hashPublicToken(rawToken),
    purpose: purpose as PublicAccessPurpose,
    business_id: caseScope.business_id,
    case_id: caseScope.id,
    payment_plan_id: paymentPlanId,
    receiving_account_id: receivingAccountId,
    created_by: access.user.id,
    expires_at: expiresAt,
  });
  if (insertError) return json({ error: "Unable to create the public link." }, 500);

  await appendSensitiveAudit({
    access, request, action: "public_link.created", entityType: "public_access_token", caseId,
    metadata: { purpose, expires_at: expiresAt },
  });

  let baseUrl: string;
  try {
    baseUrl = getAppUrl();
  } catch {
    return json({ error: "Public application URL is not configured correctly on this server." }, 503);
  }
  const path = purpose === "payment" ? "pay" : "acknowledge";
  return json({ url: `${baseUrl}/${path}/${rawToken}`, expiresAt });
}
