import "server-only";

import type Stripe from "stripe";
import {
  getBillingBusinessOwner,
  getBusinessIdByCustomer,
  isConfiguredPlanPriceId,
  isExtraSeatPriceId,
  planSlugFromPriceId,
  applySubscriptionState,
  type SubscriptionUpsertParams,
} from "./service";
import { pocketOfferFromPriceId } from "./pocket-catalog-server";
import { applyPocketSubscriptionState, recordPocketCyclePack, type PocketSubscriptionItemState } from "./pocket-billing-service";
import { commitPocketSoloUpgrade, markPocketSoloCleanup } from "@/lib/pocket/upgrade-server";
import type { SubscriptionStatus } from "./types";
import { EXTRA_SEAT_MAX } from "./catalog-server";

const SUBSCRIPTION_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  "active", "trialing", "past_due", "canceled", "incomplete", "incomplete_expired", "unpaid", "paused",
]);

type ResolvedBusiness = { businessId: string; ownerId: string; customerId: string };
export type StripeEventOutcome = { businessId: string | null; outcome: string };

function stripeResourceId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function metadataValue(metadata: Stripe.Metadata | null | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function subscriptionStatus(value: string): SubscriptionStatus {
  if (!SUBSCRIPTION_STATUSES.has(value as SubscriptionStatus)) throw new Error("Unsupported Stripe subscription status");
  return value as SubscriptionStatus;
}

function validateMetadata(metadata: Stripe.Metadata | null | undefined, business: ResolvedBusiness) {
  const metadataBusinessId = metadataValue(metadata, "business_id");
  const metadataUserId = metadataValue(metadata, "user_id");
  if (metadataBusinessId && metadataBusinessId !== business.businessId) throw new Error("Stripe business metadata does not match the canonical mapping");
  if (metadataUserId && metadataUserId !== business.ownerId) throw new Error("Stripe owner metadata does not match the canonical mapping");
}

async function resolveBusinessForSubscription(sub: Stripe.Subscription, stripe: Stripe): Promise<ResolvedBusiness> {
  const customerId = stripeResourceId(sub.customer);
  if (!customerId) throw new Error("Subscription has no customer");
  const customer = await stripe.customers.retrieve(customerId);
  if ("deleted" in customer && customer.deleted) throw new Error("Subscription customer is deleted");
  const persistedBusinessId = await getBusinessIdByCustomer(customerId);
  const candidates = [metadataValue(sub.metadata, "business_id"), metadataValue(customer.metadata, "business_id"), persistedBusinessId]
    .filter((value): value is string => Boolean(value));
  const businessId = candidates[0];
  if (!businessId || candidates.some((value) => value !== businessId)) throw new Error("Unable to establish an unambiguous subscription business mapping");
  const business = await getBillingBusinessOwner(businessId);
  if (!business) throw new Error("Subscription refers to an unknown business");
  const resolved = { businessId: business.id, ownerId: business.ownerId, customerId };
  validateMetadata(sub.metadata, resolved);
  validateMetadata(customer.metadata, resolved);
  return resolved;
}

async function applySubscription(business: ResolvedBusiness, sub: Stripe.Subscription, event: Stripe.Event) {
  const mappedPocketItems = sub.items.data.map((item) => ({ item, offerKey: pocketOfferFromPriceId(item.price?.id) }));
  if (mappedPocketItems.some(({ offerKey }) => offerKey !== null)) {
    if (mappedPocketItems.some(({ offerKey }) => offerKey === null || offerKey === "pocket_extra_invoice_pack")) {
      throw new Error("Pocket subscription contains an unconfigured or non-recurring price");
    }
    const items: PocketSubscriptionItemState[] = mappedPocketItems.map(({ item, offerKey }) => ({
      offerKey: offerKey as PocketSubscriptionItemState["offerKey"],
      providerSubscriptionId: sub.id,
      providerItemId: item.id,
      providerPriceId: item.price.id,
      providerStatus: sub.status,
      periodStart: item.current_period_start ?? null,
      periodEnd: item.current_period_end ?? null,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    }));
    await applyPocketSubscriptionState({
      businessId: business.businessId,
      stripeCustomerId: business.customerId,
      eventId: event.id,
      eventCreatedAt: event.created,
      items,
    });
    return "pocket" as const;
  }
  // A Main subscription holds one plan item and, optionally, one extra-seat
  // item. Item order is not guaranteed, so classify each item by price.
  const seatItems = sub.items.data.filter((entry) => isExtraSeatPriceId(entry.price?.id));
  const planItems = sub.items.data.filter((entry) => !isExtraSeatPriceId(entry.price?.id));
  if (planItems.length > 1 || seatItems.length > 1) {
    throw new Error("Subscription contains an unexpected combination of CollectBoss prices");
  }
  const item = planItems[0] ?? sub.items.data[0];
  const priceId = item?.price?.id ?? null;
  const planSlug = planSlugFromPriceId(priceId, metadataValue(sub.metadata, "plan_slug"));
  const status = subscriptionStatus(sub.status);
  if (["active", "trialing"].includes(status) && !isConfiguredPlanPriceId(priceId)) {
    throw new Error("Active subscription has no configured CollectBoss price mapping");
  }
  const extraSeats = Math.min(Math.max(seatItems[0]?.quantity ?? 0, 0), EXTRA_SEAT_MAX);
  const params: SubscriptionUpsertParams = {
    businessId: business.businessId, stripeCustomerId: business.customerId, stripeSubscriptionId: sub.id,
    stripePriceId: priceId, planSlug, status,
    currentPeriodStart: item?.current_period_start ?? null, currentPeriodEnd: item?.current_period_end ?? null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    extraSeats,
  };
  await applySubscriptionState(params);
  return "main" as const;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

async function completePocketSoloUpgrade(
  business: ResolvedBusiness,
  sub: Stripe.Subscription,
  event: Stripe.Event,
  stripe: Stripe,
): Promise<boolean> {
  if (metadataValue(sub.metadata, "upgrade_kind") !== "pocket_to_solo") return false;
  const runId = metadataValue(sub.metadata, "upgrade_run_id");
  if (!runId) throw new Error("Pocket Solo subscription has no upgrade run metadata");
  if (!["active", "trialing"].includes(sub.status)) return false;

  const result = await commitPocketSoloUpgrade({
    businessId: business.businessId,
    runId,
    actorId: business.ownerId,
    providerEventId: event.id,
  });
  const pocketSubscriptionIds = stringArray(result.pocketSubscriptionIds).filter((id) => id !== sub.id);
  try {
    for (const subscriptionId of pocketSubscriptionIds) {
      const existing = await stripe.subscriptions.retrieve(subscriptionId);
      if (existing.status !== "canceled") await stripe.subscriptions.cancel(subscriptionId);
    }
    await markPocketSoloCleanup({ businessId: business.businessId, runId, status: "completed" });
  } catch (error) {
    await markPocketSoloCleanup({
      businessId: business.businessId,
      runId,
      status: "failed",
      errorCode: "POCKET_SUBSCRIPTION_CLEANUP_FAILED",
    });
    throw error;
  }
  return true;
}

function invoiceSubscriptionId(invoice: Stripe.Invoice) {
  const parent = invoice.parent;
  return parent?.type === "subscription_details" ? stripeResourceId(parent.subscription_details?.subscription) : null;
}

export async function processStripeEvent(event: Stripe.Event, stripe: Stripe): Promise<StripeEventOutcome> {
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as Stripe.Checkout.Session;
    const subscriptionId = stripeResourceId(session.subscription);
    if (!subscriptionId && session.mode === "payment") {
      if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
        return { businessId: null, outcome: "pocket_cycle_pack_payment_pending" };
      }
      const customerId = stripeResourceId(session.customer);
      if (!customerId) throw new Error("Pocket pack checkout has no customer");
      const customer = await stripe.customers.retrieve(customerId);
      if ("deleted" in customer && customer.deleted) throw new Error("Pocket pack customer is deleted");
      const businessId = metadataValue(session.metadata, "business_id");
      const persistedBusinessId = await getBusinessIdByCustomer(customerId);
      if (!businessId || (persistedBusinessId && persistedBusinessId !== businessId)) throw new Error("Unable to establish Pocket pack business mapping");
      const owner = await getBillingBusinessOwner(businessId);
      if (!owner) throw new Error("Pocket pack refers to an unknown business");
      const business = { businessId: owner.id, ownerId: owner.ownerId, customerId };
      validateMetadata(session.metadata, business);
      validateMetadata(customer.metadata, business);
      const lines = await stripe.checkout.sessions.listLineItems(session.id, { limit: 2 });
      if (lines.data.length !== 1 || pocketOfferFromPriceId(lines.data[0]?.price?.id) !== "pocket_extra_invoice_pack") {
        throw new Error("Pocket pack checkout has an unconfigured price");
      }
      await recordPocketCyclePack({
        businessId,
        actorId: owner.ownerId,
        checkoutSessionId: session.id,
        paymentIntentId: stripeResourceId(session.payment_intent),
        providerEventId: event.id,
        providerEventCreatedAt: event.created,
      });
      return { businessId, outcome: "pocket_cycle_pack_applied" };
    }
    if (!subscriptionId) throw new Error("Checkout session has no subscription");
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const business = await resolveBusinessForSubscription(sub, stripe);
    validateMetadata(session.metadata, business);
    const product = await applySubscription(business, sub, event);
    if (product === "main" && await completePocketSoloUpgrade(business, sub, event, stripe)) {
      return { businessId: business.businessId, outcome: "pocket_to_solo_upgrade_completed" };
    }
    return { businessId: business.businessId, outcome: product === "pocket" ? "pocket_subscription_synchronized" : "subscription_synchronized" };
  }
  if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
    const snapshot = event.data.object as Stripe.Subscription;
    const sub = await stripe.subscriptions.retrieve(snapshot.id);
    const business = await resolveBusinessForSubscription(sub, stripe);
    const product = await applySubscription(business, sub, event);
    if (product === "main" && await completePocketSoloUpgrade(business, sub, event, stripe)) {
      return { businessId: business.businessId, outcome: "pocket_to_solo_upgrade_completed" };
    }
    return { businessId: business.businessId, outcome: product === "pocket"
      ? (sub.status === "canceled" ? "pocket_subscription_canceled" : "pocket_subscription_synchronized")
      : (sub.status === "canceled" ? "subscription_canceled" : "subscription_synchronized") };
  }
  if (["invoice.payment_succeeded", "invoice.payment_failed"].includes(event.type)) {
    const subscriptionId = invoiceSubscriptionId(event.data.object as Stripe.Invoice);
    if (!subscriptionId) return { businessId: null, outcome: "invoice_without_subscription" };
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const business = await resolveBusinessForSubscription(sub, stripe);
    const product = await applySubscription(business, sub, event);
    return { businessId: business.businessId, outcome: product === "pocket" ? "pocket_subscription_synchronized" : "subscription_synchronized" };
  }
  if (event.type === "charge.refunded") {
    const customerId = stripeResourceId((event.data.object as Stripe.Charge).customer);
    return { businessId: customerId ? await getBusinessIdByCustomer(customerId) : null, outcome: "refund_recorded_no_entitlement_change" };
  }
  return { businessId: null, outcome: "unhandled_event_type" };
}
