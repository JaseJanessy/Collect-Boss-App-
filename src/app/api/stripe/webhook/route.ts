/**
 * POST /api/stripe/webhook
 *
 * Stripe is the sole authority for subscription lifecycle state. This handler
 * verifies the unmodified request body before trusting it, claims every event
 * atomically, and fetches the current Stripe subscription before each state
 * write so delayed events cannot overwrite newer subscription state.
 */

import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripeServer, isStripeConfigured } from "@/lib/stripe/server";
import {
  claimBillingEvent,
  completeBillingEvent,
  getBillingBusinessOwner,
  getBusinessIdByCustomer,
  isConfiguredPlanPriceId,
  planSlugFromPriceId,
  upsertEntitlement,
  upsertSubscription,
  type SubscriptionUpsertParams,
} from "@/lib/billing/service";
import type { SubscriptionStatus } from "@/lib/billing/types";

export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BODY_BYTES = 1_000_000;
const SUBSCRIPTION_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  "active",
  "trialing",
  "past_due",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "unpaid",
  "paused",
]);

const ok = () => NextResponse.json({ received: true }, { status: 200 });
const fail = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

type ResolvedBusiness = {
  businessId: string;
  ownerId: string;
  customerId: string;
};

type EventOutcome = {
  businessId: string | null;
  outcome: string;
};

function stripeResourceId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function metadataValue(metadata: Stripe.Metadata | null | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function subscriptionStatus(value: string): SubscriptionStatus {
  if (!SUBSCRIPTION_STATUSES.has(value as SubscriptionStatus)) {
    throw new Error("Unsupported Stripe subscription status");
  }
  return value as SubscriptionStatus;
}

function validateMetadata(
  metadata: Stripe.Metadata | null | undefined,
  business: ResolvedBusiness,
): void {
  const metadataBusinessId = metadataValue(metadata, "business_id");
  const metadataUserId = metadataValue(metadata, "user_id");

  if (metadataBusinessId && metadataBusinessId !== business.businessId) {
    throw new Error("Stripe business metadata does not match the canonical mapping");
  }
  if (metadataUserId && metadataUserId !== business.ownerId) {
    throw new Error("Stripe owner metadata does not match the canonical mapping");
  }
}

/**
 * Resolves an event to exactly one CollectBoss business. Every mapping source
 * (subscription metadata, Stripe customer metadata, and persisted customer ID)
 * must agree; otherwise the event remains retryable for operator investigation.
 */
async function resolveBusinessForSubscription(
  sub: Stripe.Subscription,
  stripe: Stripe,
): Promise<ResolvedBusiness> {
  const customerId = stripeResourceId(sub.customer);
  if (!customerId) throw new Error("Subscription has no customer");

  const customer = await stripe.customers.retrieve(customerId);
  if ("deleted" in customer && customer.deleted) {
    throw new Error("Subscription customer is deleted");
  }

  const persistedBusinessId = await getBusinessIdByCustomer(customerId);
  const candidates = [
    metadataValue(sub.metadata, "business_id"),
    metadataValue(customer.metadata, "business_id"),
    persistedBusinessId,
  ].filter((value): value is string => Boolean(value));

  const businessId = candidates[0];
  if (!businessId || candidates.some((value) => value !== businessId)) {
    throw new Error("Unable to establish an unambiguous subscription business mapping");
  }

  const business = await getBillingBusinessOwner(businessId);
  if (!business) throw new Error("Subscription refers to an unknown business");

  const resolved: ResolvedBusiness = {
    businessId: business.id,
    ownerId: business.ownerId,
    customerId,
  };
  validateMetadata(sub.metadata, resolved);
  validateMetadata(customer.metadata, resolved);
  return resolved;
}

async function currentSubscription(
  subscriptionId: string,
  stripe: Stripe,
): Promise<Stripe.Subscription> {
  // Event delivery order is not guaranteed. Always use Stripe's present object.
  return stripe.subscriptions.retrieve(subscriptionId);
}

async function applySubscription(
  business: ResolvedBusiness,
  sub: Stripe.Subscription,
): Promise<void> {
  const priceId = sub.items.data[0]?.price?.id ?? null;
  const planSlug = planSlugFromPriceId(priceId, metadataValue(sub.metadata, "plan_slug"));
  const status = subscriptionStatus(sub.status);

  // A paid Stripe subscription must be backed by an allowlisted server price.
  // Treat a stale/misconfigured price map as a retryable configuration fault,
  // never as a silently activated free plan.
  if (["active", "trialing"].includes(status) && !isConfiguredPlanPriceId(priceId)) {
    throw new Error("Active subscription has no configured CollectBoss price mapping");
  }

  const item = sub.items.data[0];
  const params: SubscriptionUpsertParams = {
    businessId: business.businessId,
    stripeCustomerId: business.customerId,
    stripeSubscriptionId: sub.id,
    stripePriceId: priceId,
    planSlug,
    status,
    currentPeriodStart: item?.current_period_start ?? null,
    currentPeriodEnd: item?.current_period_end ?? null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };

  const [subscriptionResult, entitlementResult] = await Promise.all([
    upsertSubscription(params),
    upsertEntitlement(business.businessId, planSlug, status),
  ]);

  if (subscriptionResult.error || entitlementResult.error) {
    throw new Error("Unable to synchronize subscription state");
  }
}

function getSubscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const parent = invoice.parent;
  if (!parent || parent.type !== "subscription_details") return null;
  return stripeResourceId(parent.subscription_details?.subscription);
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  stripe: Stripe,
): Promise<EventOutcome> {
  const subscriptionId = stripeResourceId(session.subscription);
  if (!subscriptionId) throw new Error("Checkout session has no subscription");

  const sub = await currentSubscription(subscriptionId, stripe);
  const business = await resolveBusinessForSubscription(sub, stripe);
  validateMetadata(session.metadata, business);
  await applySubscription(business, sub);
  return { businessId: business.businessId, outcome: "subscription_synchronized" };
}

async function handleSubscriptionEvent(
  snapshot: Stripe.Subscription,
  stripe: Stripe,
): Promise<EventOutcome> {
  const sub = await currentSubscription(snapshot.id, stripe);
  const business = await resolveBusinessForSubscription(sub, stripe);
  await applySubscription(business, sub);
  return {
    businessId: business.businessId,
    outcome: sub.status === "canceled" ? "subscription_canceled" : "subscription_synchronized",
  };
}

async function handleInvoiceEvent(
  invoice: Stripe.Invoice,
  stripe: Stripe,
): Promise<EventOutcome> {
  const subscriptionId = getSubscriptionIdFromInvoice(invoice);
  if (!subscriptionId) {
    return { businessId: null, outcome: "invoice_without_subscription" };
  }

  const sub = await currentSubscription(subscriptionId, stripe);
  const business = await resolveBusinessForSubscription(sub, stripe);
  await applySubscription(business, sub);
  return { businessId: business.businessId, outcome: "subscription_synchronized" };
}

async function handleRefundEvent(charge: Stripe.Charge): Promise<EventOutcome> {
  const customerId = stripeResourceId(charge.customer);
  const businessId = customerId ? await getBusinessIdByCustomer(customerId) : null;
  // Refunds are authorized and actioned in Stripe; they do not independently
  // change subscription entitlements. A later subscription event remains authoritative.
  return { businessId, outcome: "refund_recorded_no_entitlement_change" };
}

async function handleEvent(event: Stripe.Event, stripe: Stripe): Promise<EventOutcome> {
  switch (event.type) {
    case "checkout.session.completed":
      return handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, stripe);
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return handleSubscriptionEvent(event.data.object as Stripe.Subscription, stripe);
    case "invoice.payment_succeeded":
    case "invoice.payment_failed":
      return handleInvoiceEvent(event.data.object as Stripe.Invoice, stripe);
    case "charge.refunded":
      return handleRefundEvent(event.data.object as Stripe.Charge);
    default:
      return { businessId: null, outcome: "unhandled_event_type" };
  }
}

export async function POST(request: NextRequest) {
  if (!isStripeConfigured || !process.env.STRIPE_WEBHOOK_SECRET) {
    return fail(503, "Webhook service is unavailable.");
  }

  const declaredSize = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredSize) && declaredSize > MAX_WEBHOOK_BODY_BYTES) {
    return fail(413, "Webhook payload is too large.");
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BODY_BYTES) {
    return fail(413, "Webhook payload is too large.");
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return fail(400, "Invalid webhook request.");

  const stripe = getStripeServer();
  if (!stripe) return fail(503, "Webhook service is unavailable.");

  let event: Stripe.Event;
  try {
    // The raw body is never parsed before this cryptographic verification.
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    console.warn("[stripe-webhook] signature_verification_failed");
    return fail(400, "Invalid webhook request.");
  }

  let claim: Awaited<ReturnType<typeof claimBillingEvent>>;
  try {
    claim = await claimBillingEvent({
      stripeEventId: event.id,
      eventType: event.type,
      stripeEventCreatedAt: typeof event.created === "number" ? event.created : null,
    });
  } catch {
    console.error("[stripe-webhook] event_claim_failed", { eventId: event.id, eventType: event.type });
    return fail(500, "Webhook processing failed. Please retry.");
  }

  if (claim === "done") {
    console.info("[stripe-webhook] duplicate_ignored", { eventId: event.id, eventType: event.type });
    return ok();
  }

  try {
    const result = await handleEvent(event, stripe);
    await completeBillingEvent({
      businessId: result.businessId,
      stripeEventId: event.id,
      eventType: event.type,
      outcome: result.outcome,
    });
    console.info("[stripe-webhook] event_processed", {
      eventId: event.id,
      eventType: event.type,
      claim,
      outcome: result.outcome,
    });
    return ok();
  } catch {
    // The event stays processed=false, so Stripe retries it. Writes above are
    // deterministic upserts sourced from the current Stripe subscription.
    console.error("[stripe-webhook] event_processing_failed", {
      eventId: event.id,
      eventType: event.type,
      claim,
    });
    return fail(500, "Webhook processing failed. Please retry.");
  }
}
