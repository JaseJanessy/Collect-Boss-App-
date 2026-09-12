import { NextRequest, NextResponse } from "next/server";

import { getAppUrl } from "@/lib/app-url";
import { getPriceId } from "@/lib/billing/catalog-server";
import { requirePocketBillingAccess } from "@/lib/billing/pocket-entitlements";
import {
  attachPocketSoloCheckout,
  loadPocketSoloUpgrade,
  PocketSoloUpgradeError,
  preparePocketSoloUpgrade,
} from "@/lib/pocket/upgrade-server";
import { getStripeServer, isStripeConfigured } from "@/lib/stripe/server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };
const responseError = (error: string, code: string, status: number, details?: unknown) =>
  NextResponse.json({ error, code, ...(details ? { details } : {}) }, { status, headers });

function preparedShape(value: unknown): { runId: string; status: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record.runId === "string" && typeof record.status === "string"
    ? { runId: record.runId, status: record.status } : null;
}

export async function POST(request: NextRequest) {
  if (!isStripeConfigured) return responseError("Solo checkout is temporarily unavailable.", "BILLING_UNAVAILABLE", 503);
  const soloPriceId = getPriceId("starter");
  if (!soloPriceId) return responseError("The CollectBoss Solo price is not configured.", "BILLING_UNAVAILABLE", 503);
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(idempotencyKey)) {
    return responseError("A valid Idempotency-Key header is required.", "INVALID_IDEMPOTENCY_KEY", 400);
  }
  const access = await requirePocketBillingAccess("billing.manage");
  if ("code" in access) return responseError(access.error, access.code, access.status);

  try {
    const prepared = preparedShape(await preparePocketSoloUpgrade(access, idempotencyKey));
    if (!prepared) return responseError("Pocket could not prepare the Solo upgrade.", "POCKET_UPGRADE_UNAVAILABLE", 503);
    if (prepared.status === "review_required") {
      return responseError("Review the flagged Pocket records before upgrading.", "POCKET_UPGRADE_REVIEW_REQUIRED", 409, await loadPocketSoloUpgrade(access));
    }
    if (!["prepared", "checkout_pending"].includes(prepared.status)) {
      return responseError("This upgrade is not ready for checkout.", "POCKET_UPGRADE_NOT_READY", 409);
    }

    const customerResult = await access.service.from("workspace_commercial_states")
      .select("stripe_customer_id").eq("business_id", access.businessId).maybeSingle();
    const customerId = customerResult.data?.stripe_customer_id;
    if (customerResult.error || !customerId) {
      return responseError("Pocket billing must be active before upgrading.", "POCKET_UPGRADE_BILLING_REQUIRED", 409);
    }
    let appUrl: string;
    try { appUrl = getAppUrl(); } catch { return responseError("Solo checkout is temporarily unavailable.", "BILLING_UNAVAILABLE", 503); }
    const stripe = getStripeServer();
    if (!stripe) return responseError("Solo checkout is temporarily unavailable.", "BILLING_UNAVAILABLE", 503);
    const metadata = {
      business_id: access.businessId,
      user_id: access.user.id,
      product_type: "main",
      plan_slug: "starter",
      upgrade_kind: "pocket_to_solo",
      upgrade_run_id: prepared.runId,
    };
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: soloPriceId, quantity: 1 }],
      success_url: `${appUrl}/pocket/upgrade?billing=success`,
      cancel_url: `${appUrl}/pocket/upgrade?billing=cancelled`,
      allow_promotion_codes: false,
      metadata,
      subscription_data: { metadata },
    }, { idempotencyKey: `pocket-solo-upgrade:${access.businessId}:${prepared.runId}` });
    if (!session.url) return responseError("Solo checkout is temporarily unavailable.", "BILLING_UNAVAILABLE", 502);
    await attachPocketSoloCheckout({ access, runId: prepared.runId, checkoutSessionId: session.id });
    return NextResponse.json({ url: session.url, runId: prepared.runId }, { headers });
  } catch (error) {
    if (error instanceof PocketSoloUpgradeError) return responseError(error.message, error.code, error.status);
    console.error("[pocket-solo-upgrade] checkout_failed", { error: error instanceof Error ? error.name : "unknown" });
    return responseError("Unable to start the Solo upgrade. Please try again.", "BILLING_UNAVAILABLE", 502);
  }
}
