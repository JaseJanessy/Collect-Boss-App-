import "server-only";

/**
 * CollectBoss Billing Service — server-side only.
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY to bypass RLS for all billing writes.
 * This file must NEVER be imported in "use client" components.
 *
 * Responsibilities:
 *  • Atomic event claiming (billing_events deduplication)
 *  • Complete billing events with a redacted processing outcome
 *  • Upsert subscriptions
 *  • Upsert entitlements based on plan + subscription status
 *  • Helper: resolve business_id from Stripe customer ID
 *  • Helper: resolve plan slug from Stripe price ID (env var lookup)
 */

import { getServiceClient } from "@/lib/supabase/service-client";
import { PLANS } from "./plans";
import type { PlanSlug, SubscriptionStatus } from "./types";

// ─── Status → entitlement decision ───────────────────────────────────────────

/** Statuses that grant the full paid plan entitlements. */
const ACTIVE_STATUSES: SubscriptionStatus[] = ["active", "trialing"];

/** Statuses that revert the business to the free plan. */
const RESTRICT_STATUSES: SubscriptionStatus[] = [
  "canceled",
  "unpaid",
  "incomplete_expired",
  "past_due",   // downgrade on failure so features are locked until payment succeeds
];

/**
 * Returns the entitlement payload for a given plan slug + subscription status.
 * - Active / trialing → full plan entitlements
 * - Any failure / cancellation → free tier
 */
export function resolveEntitlementPayload(
  planSlug: PlanSlug,
  status: SubscriptionStatus,
): {
  plan_slug:               PlanSlug;
  case_limit:              number;
  evidence_pack_limit:     number;
  team_member_limit:       number;
  payment_lock_enabled:    boolean;
  formal_demand_enabled:   boolean;
  lawyer_referral_enabled: boolean;
  reports_enabled:         boolean;
} {
  const isActive     = ACTIVE_STATUSES.includes(status);
  const isRestricted = RESTRICT_STATUSES.includes(status);

  const effectiveSlug: PlanSlug =
    isActive && !isRestricted ? planSlug : "free";

  const plan = PLANS[effectiveSlug] ?? PLANS.free;

  return {
    plan_slug:               effectiveSlug,
    case_limit:              plan.case_limit,
    evidence_pack_limit:     plan.evidence_pack_limit,
    team_member_limit:       plan.team_member_limit,
    payment_lock_enabled:    plan.payment_lock_enabled,
    formal_demand_enabled:   plan.formal_demand_enabled,
    lawyer_referral_enabled: plan.lawyer_referral_enabled,
    reports_enabled:         plan.reports_enabled,
  };
}

// ─── Price ID → Plan slug ──────────────────────────────────────────────────

/**
 * Maps a Stripe price ID to a plan slug using env vars.
 * Falls back to the metadata value, then to "free" as a last resort.
 */
export function planSlugFromPriceId(
  priceId: string | null | undefined,
  metaSlug?: string | null,
): PlanSlug {
  if (priceId) {
    const map: Partial<Record<string, PlanSlug>> = {
      [process.env.STRIPE_PRICE_STARTER ?? "___"]: "starter",
      [process.env.STRIPE_PRICE_BOSS    ?? "___"]: "boss",
      [process.env.STRIPE_PRICE_PRO     ?? "___"]: "pro",
    };
    if (map[priceId]) return map[priceId]!;
  }
  // Fallback: use metadata slug if it's a known plan
  const knownSlugs: PlanSlug[] = ["starter", "boss", "pro", "free"];
  if (metaSlug && knownSlugs.includes(metaSlug as PlanSlug)) {
    return metaSlug as PlanSlug;
  }
  return "free";
}

/** True only when a price ID is explicitly configured on this server. */
export function isConfiguredPlanPriceId(priceId: string | null | undefined): boolean {
  if (!priceId) return false;
  return [
    process.env.STRIPE_PRICE_STARTER,
    process.env.STRIPE_PRICE_BOSS,
    process.env.STRIPE_PRICE_PRO,
  ].some((configuredPriceId) => Boolean(configuredPriceId) && configuredPriceId === priceId);
}

// ─── Idempotency ──────────────────────────────────────────────────────────────

/**
 * Returns true if a billing event with this Stripe event ID has already
 * been fully processed. Safe to call with a missing service client.
 */
export type BillingEventClaim = "new" | "retry" | "done";

/**
 * Atomically claims a Stripe event by inserting its unique event ID.
 *
 * A unique-constraint conflict is an expected duplicate delivery, not a
 * failed webhook. When an earlier delivery did not complete, returning
 * "retry" lets the handler replay only idempotent, source-of-truth writes.
 */
export async function claimBillingEvent(params: {
  stripeEventId: string;
  eventType: string;
  stripeEventCreatedAt: number | null;
}): Promise<BillingEventClaim> {
  const client = await getServiceClient();
  if (!client) throw new Error("Billing event store unavailable");

  const { error: insertError } = await client.from("billing_events").insert({
    stripe_event_id: params.stripeEventId,
    event_type: params.eventType,
    processed: false,
    // Keep only operational metadata; never persist a webhook payload.
    metadata: {
      received_at: new Date().toISOString(),
      stripe_event_created_at: params.stripeEventCreatedAt,
    },
  });

  if (!insertError) return "new";
  if (insertError.code !== "23505") {
    throw new Error("Unable to claim billing event");
  }

  const { data, error: readError } = await client
    .from("billing_events")
    .select("processed")
    .eq("stripe_event_id", params.stripeEventId)
    .maybeSingle();

  if (readError || !data) {
    throw new Error("Unable to read claimed billing event");
  }

  return (data as { processed: boolean }).processed ? "done" : "retry";
}

// ─── Billing event persistence ────────────────────────────────────────────────

export async function completeBillingEvent(params: {
  businessId:     string | null;
  stripeEventId:  string;
  eventType:      string;
  outcome:        string;
}): Promise<void> {
  const client = await getServiceClient();
  if (!client) {
    throw new Error("Billing event store unavailable");
  }

  const { data, error } = await client.from("billing_events").update(
    {
      business_id:     params.businessId,
      event_type:      params.eventType,
      processed:       true,
      metadata: {
        outcome: params.outcome,
        processed_at: new Date().toISOString(),
      },
    },
  ).eq("stripe_event_id", params.stripeEventId).select("stripe_event_id").maybeSingle();

  if (error || !data) throw new Error("Unable to complete billing event");
}

// ─── Subscription upsert ──────────────────────────────────────────────────────

export interface SubscriptionUpsertParams {
  businessId:            string;
  stripeCustomerId:      string;
  stripeSubscriptionId:  string;
  stripePriceId:         string | null;
  planSlug:              PlanSlug;
  status:                SubscriptionStatus;
  currentPeriodStart:    number | null; // Unix timestamp from Stripe
  currentPeriodEnd:      number | null; // Unix timestamp from Stripe
  cancelAtPeriodEnd:     boolean;
}

export async function upsertSubscription(
  params: SubscriptionUpsertParams,
): Promise<{ error: string | null }> {
  const client = await getServiceClient();
  if (!client) return { error: "Service client unavailable — check SUPABASE_SERVICE_ROLE_KEY" };

  const { error } = await client.from("subscriptions").upsert(
    {
      business_id:             params.businessId,
      stripe_customer_id:      params.stripeCustomerId,
      stripe_subscription_id:  params.stripeSubscriptionId,
      stripe_price_id:         params.stripePriceId,
      plan_slug:               params.planSlug,
      status:                  params.status,
      current_period_start:    params.currentPeriodStart
        ? new Date(params.currentPeriodStart * 1000).toISOString()
        : null,
      current_period_end:      params.currentPeriodEnd
        ? new Date(params.currentPeriodEnd * 1000).toISOString()
        : null,
      cancel_at_period_end:    params.cancelAtPeriodEnd,
    },
    { onConflict: "business_id" },
  );

  if (error) {
    console.error("[billing] upsertSubscription error:", error.message);
    return { error: error.message };
  }
  return { error: null };
}

// ─── Entitlement upsert ───────────────────────────────────────────────────────

export async function upsertEntitlement(
  businessId: string,
  planSlug:   PlanSlug,
  status:     SubscriptionStatus,
): Promise<{ error: string | null }> {
  const client = await getServiceClient();
  if (!client) return { error: "Service client unavailable — check SUPABASE_SERVICE_ROLE_KEY" };

  const payload = resolveEntitlementPayload(planSlug, status);

  const { error } = await client.from("entitlements").upsert(
    { business_id: businessId, ...payload },
    { onConflict: "business_id" },
  );

  if (error) {
    console.error("[billing] upsertEntitlement error:", error.message);
    return { error: error.message };
  }
  return { error: null };
}

// ─── Business ID resolution ───────────────────────────────────────────────────

/**
 * Looks up the business_id for a given Stripe customer ID.
 * Used for invoice events where we don't have a business_id in metadata.
 */
export async function getBusinessIdByCustomer(
  stripeCustomerId: string,
): Promise<string | null> {
  const client = await getServiceClient();
  if (!client) return null;

  const { data, error } = await client
    .from("subscriptions")
    .select("business_id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();

  if (error) throw new Error("Unable to resolve Stripe customer mapping");

  return (data as { business_id: string } | null)?.business_id ?? null;
}

/** Returns the canonical business/owner mapping used to validate Stripe metadata. */
export async function getBillingBusinessOwner(
  businessId: string,
): Promise<{ id: string; ownerId: string } | null> {
  const client = await getServiceClient();
  if (!client) throw new Error("Billing business store unavailable");

  const { data, error } = await client
    .from("businesses")
    .select("id, owner_id")
    .eq("id", businessId)
    .maybeSingle();

  if (error) throw new Error("Unable to resolve billing business");
  if (!data) return null;

  const business = data as { id: string; owner_id: string };
  return { id: business.id, ownerId: business.owner_id };
}
