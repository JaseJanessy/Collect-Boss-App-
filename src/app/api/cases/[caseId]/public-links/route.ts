import { NextRequest, NextResponse } from "next/server";
import { getAppUrl } from "@/lib/app-url";
import {
  getOwnedCaseScope,
  generatePublicToken,
  hashPublicToken,
  type PublicAccessPurpose,
} from "@/lib/public-access/service";
import { getServerClient } from "@/lib/supabase/server-client";
import { getServiceClient } from "@/lib/supabase/service-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ caseId: string }> },
) {
  const ownerClient = await getServerClient();
  const { data: { user } } = ownerClient ? await ownerClient.auth.getUser() : { data: { user: null } };
  if (!user) return json({ error: "You must be signed in." }, 401);

  const { caseId } = await context.params;
  const caseScope = await getOwnedCaseScope(caseId, user.id);
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

  const service = await getServiceClient();
  if (!service) return json({ error: "Public link service is unavailable." }, 503);

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
    receivingAccountId = (paymentCase as { receiving_account_id: string | null }).receiving_account_id;
    if (!receivingAccountId) {
      const { data: primary } = await service.from("receiving_accounts").select("id").eq("business_id", caseScope.business_id).eq("is_primary", true).maybeSingle();
      receivingAccountId = (primary as { id: string } | null)?.id ?? null;
    }
    if (!receivingAccountId) return json({ error: "Choose a receiving account before creating a payment link." }, 409);
  }
  const { error: insertError } = await service.from("public_access_tokens").insert({
    token_hash: hashPublicToken(rawToken),
    purpose: purpose as PublicAccessPurpose,
    case_id: caseScope.id,
    payment_plan_id: paymentPlanId,
    receiving_account_id: receivingAccountId,
    created_by: user.id,
    expires_at: expiresAt,
  });
  if (insertError) return json({ error: "Unable to create the public link." }, 500);

  let baseUrl: string;
  try {
    baseUrl = getAppUrl();
  } catch {
    return json({ error: "Public application URL is not configured correctly on this server." }, 503);
  }
  const path = purpose === "payment" ? "pay" : "acknowledge";
  return json({ url: `${baseUrl}/${path}/${rawToken}`, expiresAt });
}
