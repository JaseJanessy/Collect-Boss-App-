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
import { getStripeServer, isStripeConfigured } from "@/lib/stripe/server";
import { getServerClient } from "@/lib/supabase/server-client";

export const dynamic = "force-dynamic";

const err = (msg: string, status = 400) =>
  NextResponse.json({ error: msg }, { status });

export async function POST(_request: NextRequest) {
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
  const supabase = await getServerClient();
  if (!supabase) return err("Auth service unavailable", 503);

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return err("Authentication required", 401);

  // ── Get business_id ───────────────────────────────────────────────────────
  const { data: biz } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();

  const businessId = (biz as { id: string } | null)?.id ?? null;
  if (!businessId) return err("Business profile not found. Complete onboarding first.", 404);

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
    });

    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (stripeErr: unknown) {
    const message =
      stripeErr instanceof Error ? stripeErr.message : "Stripe error";
    console.error("[billing] Customer portal session error:", message);
    return err("Unable to open the billing portal. Please try again.", 502);
  }
}
