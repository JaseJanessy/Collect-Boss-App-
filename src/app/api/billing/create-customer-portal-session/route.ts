/**
 * POST /api/billing/create-customer-portal-session
 *
 * Creates a Stripe Billing Portal session so the authenticated user can:
 *  • Update their payment method
 *  • Cancel their subscription
 *  • View past invoices
 *  • Update their billing address
 *
 * Security:
 *  • Requires authenticated Supabase session
 *  • stripe_customer_id is ALWAYS read from the database — never from the client
 *  • User can only open a portal for their own business subscription
 *  • STRIPE_SECRET_KEY is server-side only
 *
 * Post-portal:
 *  • Any subscription changes (cancel, plan change) are handled by the
 *    Stripe webhook at /api/stripe/webhook — this route does NOT update
 *    subscription status.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAppUrl } from "@/lib/app-url";
import { requireTenantPermission } from "@/lib/auth/tenant-access";
import { getStripeServer, isStripeConfigured } from "@/lib/stripe/server";

export const dynamic = "force-dynamic";

const err = (msg: string, status = 400) =>
  NextResponse.json({ error: msg }, { status });

export async function POST(request: NextRequest) {
  // ── Guard: Stripe must be configured ──────────────────────────────────────
  if (!isStripeConfigured) {
    return err("Stripe is not configured on this server.", 503);
  }

  let appUrl: string;
  try {
    appUrl = getAppUrl();
  } catch {
    return err("Public application URL is not configured correctly on this server.", 503);
  }

  const stripe = getStripeServer()!;

  // ── Verify auth ───────────────────────────────────────────────────────────
  const access = await requireTenantPermission("billing.manage");
  if ("error" in access) return err(access.error ?? "Billing access denied.", access.status ?? 403);
  const { client: supabase, businessId } = access;
  const requestKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(requestKey)) return err("A valid Idempotency-Key header is required.", 400);

  // ── Get business_id ───────────────────────────────────────────────────────
  // ── Get stripe_customer_id from DB (never from client) ───────────────────
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id, plan_slug, status")
    .eq("business_id", businessId)
    .maybeSingle();

  const stripeCustomerId =
    (sub as { stripe_customer_id: string | null } | null)?.stripe_customer_id ?? null;

  if (!stripeCustomerId) {
    return err(
      "No active billing account found. Subscribe to a paid plan first before managing your subscription.",
      404,
    );
  }

  // ── Build return URL ───────────────────────────────────────────────────────
  const returnUrl = `${appUrl}/billing`;

  // ── Create Stripe Billing Portal session ──────────────────────────────────
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer:   stripeCustomerId,
      return_url: returnUrl,
    }, { idempotencyKey: `portal:${businessId}:${requestKey}` });

    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (stripeErr: unknown) {
    const message =
      stripeErr instanceof Error ? stripeErr.message : "Stripe error";
    console.error("[billing] Customer portal session error:", message);
    return err("Unable to open the billing portal. Please try again.", 502);
  }
}
