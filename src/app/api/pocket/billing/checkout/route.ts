import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";

import { getAppUrl } from "@/lib/app-url";
import { assertCompletePocketPriceConfiguration, configuredPocketOffer } from "@/lib/billing/pocket-catalog-server";
import {
  attachPocketCheckoutSession,
  getPocketStripeCustomerId,
  reservePocketCheckout,
} from "@/lib/billing/pocket-billing-service";
import { requirePocketBillingAccess } from "@/lib/billing/pocket-entitlements";
import { isPocketOfferKey } from "@/lib/billing/pocket-policy";
import { getStripeServer, isStripeConfigured } from "@/lib/stripe/server";

export const dynamic = "force-dynamic";

if (process.env.NEXT_PUBLIC_APP_ENV === "production") {
  assertCompletePocketPriceConfiguration();
}

const responseError = (error: string, code: string, status: number) =>
  NextResponse.json({ error, code }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  if (!isStripeConfigured) return responseError("Billing checkout is temporarily unavailable.", "BILLING_UNAVAILABLE", 503);
  const access = await requirePocketBillingAccess("billing.manage");
  if ("code" in access) return responseError(access.error, access.code, access.status);
  const body = await request.json().catch(() => null) as { offerKey?: unknown } | null;
  const offerKey = typeof body?.offerKey === "string" ? body.offerKey : "";
  if (!isPocketOfferKey(offerKey)) return responseError("Choose an available Pocket offer.", "INVALID_OFFER", 400);
  const offer = configuredPocketOffer(offerKey);
  if (!offer) return responseError("This Pocket offer is not configured.", "BILLING_UNAVAILABLE", 503);
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey)) return responseError("A valid Idempotency-Key header is required.", "INVALID_IDEMPOTENCY_KEY", 400);

  let appUrl: string;
  try { appUrl = getAppUrl(); } catch { return responseError("Billing checkout is temporarily unavailable.", "BILLING_UNAVAILABLE", 503); }
  const stripe = getStripeServer();
  if (!stripe) return responseError("Billing checkout is temporarily unavailable.", "BILLING_UNAVAILABLE", 503);

  let reservation: Awaited<ReturnType<typeof reservePocketCheckout>>;
  try {
    reservation = await reservePocketCheckout({ businessId: access.businessId, actorId: access.user.id, offerKey, idempotencyKey });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = message.includes("ADD_ON_REQUIRED") ? "ADD_ON_REQUIRED"
      : message.includes("LIMIT_REACHED") ? "LIMIT_REACHED"
        : message.includes("PLAN_NOT_AUTHORISED") ? "PLAN_NOT_AUTHORISED"
          : "BILLING_UNAVAILABLE";
    return responseError("This Pocket purchase is not available.", code, code === "BILLING_UNAVAILABLE" ? 503 : 409);
  }

  try {
    let customerId = await getPocketStripeCustomerId(access.businessId);
    if (!customerId) {
      if (offer.definition.kind !== "base") return responseError("Activate Pocket before purchasing an add-on.", "PLAN_NOT_AUTHORISED", 409);
      const customer = await stripe.customers.create({
        email: access.user.email ?? undefined,
        metadata: { business_id: access.businessId, user_id: access.user.id, product_type: "pocket" },
      }, { idempotencyKey: `pocket-customer:${access.businessId}:${idempotencyKey}` });
      customerId = customer.id;
    }

    const metadata: Stripe.MetadataParam = {
      business_id: access.businessId,
      user_id: access.user.id,
      product_type: "pocket",
      offer_key: offerKey,
      reservation_id: reservation.reservation_id,
    };
    const session = await stripe.checkout.sessions.create({
      mode: offer.definition.checkoutMode,
      customer: customerId,
      line_items: [{ price: offer.priceId, quantity: 1 }],
      success_url: `${appUrl}/pocket/more?billing=success`,
      cancel_url: `${appUrl}/pocket/more?billing=cancelled`,
      allow_promotion_codes: false,
      metadata,
      ...(offer.definition.checkoutMode === "subscription" ? { subscription_data: { metadata } } : {}),
    }, { idempotencyKey: `pocket-checkout:${access.businessId}:${offerKey}:${idempotencyKey}` });
    if (!session.url) return responseError("Billing checkout is temporarily unavailable.", "BILLING_UNAVAILABLE", 502);
    await attachPocketCheckoutSession(reservation.reservation_id, session.id);
    return NextResponse.json({ url: session.url }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[pocket-billing] checkout_failed", { businessId: access.businessId, offerKey, error: error instanceof Error ? error.name : "unknown" });
    return responseError("Unable to start Pocket checkout. Please try again.", "BILLING_UNAVAILABLE", 502);
  }
}
