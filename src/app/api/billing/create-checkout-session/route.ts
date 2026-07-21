/**
 * POST /api/billing/create-checkout-session
 *
 * Creates a Stripe Checkout Session for a subscription plan.
 *
 * Security:
 *  • STRIPE_SECRET_KEY is server-side only — never in client bundle
 *  • plan_slug is validated server-side before looking up a price ID
 *  • Price ID comes from env vars only — client cannot influence price amount
 *  • User must be authenticated (Supabase session cookie)
 *  • Does NOT update subscription status — webhook will do that later
 */

import { NextRequest, NextResponse } from "next/server";
import { getAppUrl } from "@/lib/app-url";
import { getStripeServer, getPriceId, isCheckoutSlug, isStripeConfigured } from "@/lib/stripe/server";
import { getServerClient } from "@/lib/supabase/server-client";

// ─── Response helpers ─────────────────────────────────────────────────────────

const err = (msg: string, status: number) =>
  NextResponse.json({ error: msg }, { status });

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // 1. Guard: Stripe must be configured
  if (!isStripeConfigured) {
    return err(
      "Stripe is not configured on this server. Add STRIPE_SECRET_KEY to your environment.",
      503,
    );
  }

  let appUrl: string;
  try {
    appUrl = getAppUrl();
  } catch {
    return err("Public application URL is not configured correctly on this server.", 503);
  }

  const stripe = getStripeServer()!;

  // 2. Parse and validate request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err("Invalid JSON body", 400);
  }

  const { plan_slug } =
    body && typeof body === "object" && "plan_slug" in body
      ? (body as { plan_slug: string })
      : { plan_slug: "" };

  if (!plan_slug || !isCheckoutSlug(plan_slug)) {
    return err(
      `Invalid plan_slug "${plan_slug}". Must be one of: starter, boss, pro`,
      400,
    );
  }

  // 3. Resolve price ID from env — never trust the client
  const priceId = getPriceId(plan_slug);
  if (!priceId) {
    return err(
      `No Stripe price configured for plan "${plan_slug}". ` +
      `Set STRIPE_PRICE_${plan_slug.toUpperCase()} in your environment.`,
      503,
    );
  }

  // 4. Verify the logged-in user
  const supabase = await getServerClient();
  if (!supabase) {
    return err("Auth service unavailable", 503);
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return err("Authentication required", 401);
  }

  // 5. Resolve the business_id for this user
  const { data: business, error: bizError } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (bizError || !business) {
    return err("Business profile not found. Complete onboarding first.", 404);
  }

  const businessId = (business as { id: string }).id;

  // 6. Reuse or create a Stripe Customer
  // Look for an existing customer ID stored in subscriptions table
  const { data: existingSub } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("business_id", businessId)
    .maybeSingle();

  const existingCustomerId =
    (existingSub as { stripe_customer_id: string | null } | null)
      ?.stripe_customer_id ?? null;

  let customerId: string;

  if (existingCustomerId) {
    customerId = existingCustomerId;
  } else {
    // Create a new Stripe customer — do NOT store it here.
    // The webhook will persist the customer ID once payment completes.
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: {
        business_id: businessId,
        user_id:     user.id,
      },
    });
    customerId = customer.id;
  }

  // 7. Build redirect URLs
  const successUrl = `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl  = `${appUrl}/billing/cancel`;

  // 8. Create the Stripe Checkout Session
  try {
    const session = await stripe.checkout.sessions.create({
      mode:                  "subscription",
      customer:              customerId,
      line_items:            [{ price: priceId, quantity: 1 }],
      success_url:           successUrl,
      cancel_url:            cancelUrl,
      allow_promotion_codes: true,
      metadata: {
        business_id: businessId,
        user_id:     user.id,
        plan_slug,
      },
      subscription_data: {
        metadata: {
          business_id: businessId,
          user_id:     user.id,
          plan_slug,
        },
      },
    });

    if (!session.url) {
      return err("Stripe did not return a checkout URL", 500);
    }

    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (stripeErr: unknown) {
    const message =
      stripeErr instanceof Error ? stripeErr.message : "Stripe error";
    console.error("[billing] Stripe checkout session error:", message);
    return err("Unable to start checkout. Please try again.", 502);
  }
}
