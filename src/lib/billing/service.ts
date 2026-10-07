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
export { isConfiguredPlanPriceId, isExtraSeatPriceId, planSlugFromPriceId } from "./catalog-server";

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
// Stripe price resolution is centralized in catalog-server.ts.

/** True only when a price ID is explicitly configured on this server. */

// ─── Idempotency ──────────────────────────────────────────────────────────────

/**
 * Returns true if a billing event with this Stripe event ID has already
 * been fully processed. Safe to call with a missing service client.
 */
export type BillingEventClaim = "new" | "retry" | "done" | "busy";

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
  const { data, error } = await client.rpc("billing_claim_event", {
    p_stripe_event_id: params.stripeEventId,
    p_event_type: params.eventType,
    p_event_created_at: params.stripeEventCreatedAt ? new Date(params.stripeEventCreatedAt * 1000).toISOString() : null,
  });
  if (error || !data || !["new", "retry", "done", "busy"].includes(data)) throw new Error("Unable to claim billing event");
  return data as BillingEventClaim;
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
      status:          "succeeded",
      processed_at:    new Date().toISOString(),
      last_error_code: null,
      last_error_message: null,
      metadata: {
        outcome: params.outcome,
        processed_at: new Date().toISOString(),
      },
    },
  ).eq("stripe_event_id", params.stripeEventId).select("stripe_event_id").maybeSingle();

  if (error || !data) throw new Error("Unable to complete billing event");
}

export async function failBillingEvent(params: {
  stripeEventId: string;
  errorCode: string;
  errorMessage: string;
}): Promise<"retry_scheduled" | "dead_letter"> {
  const client = await getServiceClient();
  if (!client) throw new Error("Billing event store unavailable");
  const { data: existing, error: readError } = await client.from("billing_events")
    .select("attempts").eq("stripe_event_id", params.stripeEventId).maybeSingle();
  if (readError || !existing) throw new Error("Unable to load failed billing event");
  const attempts = Number(existing.attempts ?? 1);
  const status = attempts >= 8 ? "dead_letter" as const : "retry_scheduled" as const;
  const retryMinutes = Math.min(24 * 60, 2 ** Math.min(attempts, 10));
  const { error } = await client.from("billing_events").update({
    status,
    next_attempt_at: new Date(Date.now() + retryMinutes * 60_000).toISOString(),
    last_error_code: params.errorCode.slice(0, 100),
    last_error_message: params.errorMessage.slice(0, 1000),
  }).eq("stripe_event_id", params.stripeEventId).eq("processed", false);
  if (error) throw new Error("Unable to persist failed billing event");
  return status;
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
  extraSeats?:           number;
}

export async function applySubscriptionState(params: SubscriptionUpsertParams): Promise<void> {
  const client = await getServiceClient();
  if (!client) throw new Error("Billing state store unavailable");
  const { error } = await client.rpc("billing_apply_subscription_state", {
    p_business_id: params.businessId,
    p_customer_id: params.stripeCustomerId,
    p_subscription_id: params.stripeSubscriptionId,
    p_price_id: params.stripePriceId,
    p_plan_slug: params.planSlug,
    p_status: params.status,
    p_period_start: params.currentPeriodStart ? new Date(params.currentPeriodStart * 1000).toISOString() : null,
    p_period_end: params.currentPeriodEnd ? new Date(params.currentPeriodEnd * 1000).toISOString() : null,
    p_cancel_at_period_end: params.cancelAtPeriodEnd,
    p_extra_seats: params.extraSeats ?? 0,
  });
  if (error) throw new Error("Unable to synchronize subscription and entitlement state atomically");
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

  const [main, pocket] = await Promise.all([
    client.from("subscriptions").select("business_id").eq("stripe_customer_id", stripeCustomerId).maybeSingle(),
    client.from("workspace_commercial_states").select("business_id").eq("stripe_customer_id", stripeCustomerId).maybeSingle(),
  ]);
  if (main.error || pocket.error) throw new Error("Unable to resolve Stripe customer mapping");
  const candidates = [main.data?.business_id, pocket.data?.business_id].filter((value): value is string => Boolean(value));
  if (new Set(candidates).size > 1) throw new Error("Stripe customer mapping is ambiguous");
  return candidates[0] ?? null;
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
