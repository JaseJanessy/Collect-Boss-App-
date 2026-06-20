/**
 * POST /api/stripe/webhook
 *
 * Receives and processes Stripe events for subscription lifecycle management.
 *
 * Security:
 *  • Stripe signature is verified with STRIPE_WEBHOOK_SECRET before any processing
 *  • Raw request body is used for signature verification (not parsed JSON)
 *  • SUPABASE_SERVICE_ROLE_KEY is used for DB writes — bypasses RLS safely
 *  • This route is NOT protected by the Supabase auth middleware (it's a public
 *    webhook endpoint, but Stripe signature verification is the auth mechanism)
 *  • Normal users cannot call this route to upgrade their own subscription
 *
 * Idempotency:
 *  • Each Stripe event ID is stored in billing_events
 *  • Duplicate events (stripe_event_id already processed=true) are skipped
 *  • Returns 200 to Stripe on duplicates to prevent retries
 *
 * Events handled:
 *  • checkout.session.completed
 *  • customer.subscription.created
 *  • customer.subscription.updated
 *  • customer.subscription.deleted
 *  • invoice.payment_succeeded
 *  • invoice.payment_failed
 */

import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripeServer, isStripeConfigured } from "@/lib/stripe/server";
import {
  isBillingEventProcessed,
  saveBillingEvent,
  upsertSubscription,
  upsertEntitlement,
  getBusinessIdByCustomer,
  planSlugFromPriceId,
  type SubscriptionUpsertParams,
} from "@/lib/billing/service";
import type { PlanSlug, SubscriptionStatus } from "@/lib/billing/types";

// Prevent Next.js from statically analysing this route
export const dynamic = "force-dynamic";

// ─── Response helpers ─────────────────────────────────────────────────────────

const ok   = (msg = "ok")   => NextResponse.json({ received: true, msg }, { status: 200 });
const fail = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // ── Guard: Stripe must be configured ──────────────────────────────────────
  if (!isStripeConfigured) {
    return fail("Stripe is not configured on this server.", 503);
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  if (!webhookSecret) {
    return fail("STRIPE_WEBHOOK_SECRET is not set.", 503);
  }

  // ── Read raw body (required for signature verification) ───────────────────
  const rawBody = await request.text();
  const sigHeader = request.headers.get("stripe-signature");

  if (!sigHeader) {
    return fail("Missing stripe-signature header", 400);
  }

  // ── Verify signature ──────────────────────────────────────────────────────
  const stripe = getStripeServer()!;
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, sigHeader, webhookSecret);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Signature verification failed";
    // Log safely — do NOT log the secret or the raw body
    console.error("[webhook] Signature verification failed:", msg);
    return fail(`Webhook signature invalid: ${msg}`, 400);
  }

  const eventId   = event.id;
  const eventType = event.type;

  // ── Idempotency check ─────────────────────────────────────────────────────
  const alreadyDone = await isBillingEventProcessed(eventId);
  if (alreadyDone) {
    return ok(`Duplicate event ${eventId} — skipped`);
  }

  // ── Save event record (unprocessed) ──────────────────────────────────────
  // Save first as unprocessed. We'll mark processed=true at the end.
  await saveBillingEvent({
    businessId:    null,  // updated below once we resolve it
    stripeEventId: eventId,
    eventType,
    metadata:      {},
    processed:     false,
  });

  // ── Route to event handler ────────────────────────────────────────────────
  let businessId: string | null = null;

  try {
    switch (eventType) {
      case "checkout.session.completed":
        businessId = await handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session,
          stripe,
        );
        break;

      case "customer.subscription.created":
      case "customer.subscription.updated":
        businessId = await handleSubscriptionChange(
          event.data.object as Stripe.Subscription,
        );
        break;

      case "customer.subscription.deleted":
        businessId = await handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
        );
        break;

      case "invoice.payment_succeeded":
        businessId = await handleInvoicePaymentSucceeded(
          event.data.object as Stripe.Invoice,
          stripe,
        );
        break;

      case "invoice.payment_failed":
        businessId = await handleInvoicePaymentFailed(
          event.data.object as Stripe.Invoice,
          stripe,
        );
        break;

      default:
        // Unhandled event type — still return 200 so Stripe stops retrying
        await saveBillingEvent({
          businessId:    null,
          stripeEventId: eventId,
          eventType,
          metadata:      { note: "unhandled_event_type" },
          processed:     true,
        });
        return ok(`Unhandled event type: ${eventType}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[webhook] Error processing ${eventType} (${eventId}):`, msg);
    // Return 500 so Stripe retries the event
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // ── Mark event as processed ───────────────────────────────────────────────
  await saveBillingEvent({
    businessId,
    stripeEventId: eventId,
    eventType,
    metadata:      { processed_at: new Date().toISOString() },
    processed:     true,
  });

  return ok();
}

// ─── checkout.session.completed ──────────────────────────────────────────────

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  stripe:  Stripe,
): Promise<string | null> {
  const businessId = session.metadata?.business_id ?? null;
  const metaSlug   = session.metadata?.plan_slug   ?? null;

  if (!businessId) {
    console.error("[webhook] checkout.session.completed: missing business_id in metadata");
    return null;
  }

  // The subscription is created by Stripe — retrieve it to get current state
  const subscriptionId = typeof session.subscription === "string"
    ? session.subscription
    : session.subscription?.id ?? null;

  if (!subscriptionId) {
    console.error("[webhook] checkout.session.completed: no subscription ID on session");
    return businessId;
  }

  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  await applySubscription(businessId, sub, metaSlug);

  return businessId;
}

// ─── customer.subscription.created / updated ─────────────────────────────────

async function handleSubscriptionChange(
  sub: Stripe.Subscription,
): Promise<string | null> {
  const businessId = sub.metadata?.business_id ?? null;
  const metaSlug   = sub.metadata?.plan_slug   ?? null;

  if (!businessId) {
    // Fall back to looking up by customer ID
    const customerId = typeof sub.customer === "string"
      ? sub.customer
      : sub.customer.id;
    const found = await getBusinessIdByCustomer(customerId);
    if (!found) {
      console.error("[webhook] subscription event: cannot resolve business_id");
      return null;
    }
    await applySubscription(found, sub, metaSlug);
    return found;
  }

  await applySubscription(businessId, sub, metaSlug);
  return businessId;
}

// ─── customer.subscription.deleted ───────────────────────────────────────────

async function handleSubscriptionDeleted(
  sub: Stripe.Subscription,
): Promise<string | null> {
  const customerId = typeof sub.customer === "string"
    ? sub.customer
    : sub.customer.id;

  const businessId =
    sub.metadata?.business_id ??
    (await getBusinessIdByCustomer(customerId));

  if (!businessId) {
    console.error("[webhook] subscription.deleted: cannot resolve business_id");
    return null;
  }

  const metaSlug = sub.metadata?.plan_slug ?? null;
  const priceId  = sub.items.data[0]?.price?.id ?? null;
  const planSlug = planSlugFromPriceId(priceId, metaSlug);

  // In Stripe v22, current_period_start/end live on SubscriptionItem, not Subscription
  const item = sub.items.data[0];

  // Mark canceled in subscriptions
  await upsertSubscription({
    businessId,
    stripeCustomerId:     customerId,
    stripeSubscriptionId: sub.id,
    stripePriceId:        priceId,
    planSlug,
    status:               "canceled",
    currentPeriodStart:   item?.current_period_start ?? null,
    currentPeriodEnd:     item?.current_period_end   ?? null,
    cancelAtPeriodEnd:    sub.cancel_at_period_end,
  });

  // Revert entitlement to free
  await upsertEntitlement(businessId, planSlug, "canceled");

  return businessId;
}

// ─── Stripe v22 helper: extract subscription ID from invoice ─────────────────
//
// In Stripe API versions 2025+, Invoice.subscription was removed.
// The subscription reference now lives at invoice.parent.subscription_details.subscription.

function getSubscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const parent = invoice.parent;
  if (!parent || parent.type !== "subscription_details") return null;
  const sub = parent.subscription_details?.subscription;
  if (!sub) return null;
  return typeof sub === "string" ? sub : sub.id;
}

// ─── invoice.payment_succeeded ───────────────────────────────────────────────

async function handleInvoicePaymentSucceeded(
  invoice: Stripe.Invoice,
  stripe:  Stripe,
): Promise<string | null> {
  const subscriptionId = getSubscriptionIdFromInvoice(invoice);
  if (!subscriptionId) return null;

  const rawCustomer = invoice.customer;
  const customerId  =
    typeof rawCustomer === "string"
      ? rawCustomer
      : (rawCustomer as Stripe.Customer | null)?.id ?? null;
  if (!customerId) return null;

  const businessId = await getBusinessIdByCustomer(customerId);
  if (!businessId) return null;

  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  await applySubscription(businessId, sub, null);

  return businessId;
}

// ─── invoice.payment_failed ───────────────────────────────────────────────────

async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  stripe:  Stripe,
): Promise<string | null> {
  const subscriptionId = getSubscriptionIdFromInvoice(invoice);
  if (!subscriptionId) return null;

  const rawCustomer = invoice.customer;
  const customerId  =
    typeof rawCustomer === "string"
      ? rawCustomer
      : (rawCustomer as Stripe.Customer | null)?.id ?? null;
  if (!customerId) return null;

  const businessId = await getBusinessIdByCustomer(customerId);
  if (!businessId) return null;

  // Stripe sets subscription.status → past_due after a failed invoice
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  await applySubscription(businessId, sub, null);

  return businessId;
}

// ─── Shared: apply a Stripe Subscription object to DB ────────────────────────

async function applySubscription(
  businessId: string,
  sub:        Stripe.Subscription,
  metaSlug:   string | null,
): Promise<void> {
  const customerId = typeof sub.customer === "string"
    ? sub.customer
    : sub.customer.id;

  const priceId  = sub.items.data[0]?.price?.id ?? null;
  const planSlug = planSlugFromPriceId(
    priceId,
    metaSlug ?? sub.metadata?.plan_slug,
  );

  const status = sub.status as SubscriptionStatus;

  // In Stripe v22, current_period_start/end live on SubscriptionItem, not Subscription
  const item = sub.items.data[0];

  const params: SubscriptionUpsertParams = {
    businessId,
    stripeCustomerId:     customerId,
    stripeSubscriptionId: sub.id,
    stripePriceId:        priceId,
    planSlug,
    status,
    currentPeriodStart:   item?.current_period_start ?? null,
    currentPeriodEnd:     item?.current_period_end   ?? null,
    cancelAtPeriodEnd:    sub.cancel_at_period_end,
  };

  const [subResult, entResult] = await Promise.all([
    upsertSubscription(params),
    upsertEntitlement(businessId, planSlug, status),
  ]);

  if (subResult.error) {
    throw new Error(`Subscription upsert failed: ${subResult.error}`);
  }
  if (entResult.error) {
    throw new Error(`Entitlement upsert failed: ${entResult.error}`);
  }
}
