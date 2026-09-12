import "server-only";

import { getServiceClient } from "@/lib/supabase/service-client";
import type { PocketOfferKey } from "./pocket-policy";

export interface PocketSubscriptionItemState {
  offerKey: Exclude<PocketOfferKey, "pocket_extra_invoice_pack">;
  providerSubscriptionId: string;
  providerItemId: string;
  providerPriceId: string;
  providerStatus: string;
  periodStart: number | null;
  periodEnd: number | null;
  cancelAtPeriodEnd: boolean;
}

export async function applyPocketSubscriptionState(params: {
  businessId: string;
  stripeCustomerId: string;
  eventId: string;
  eventCreatedAt: number;
  items: PocketSubscriptionItemState[];
}) {
  const client = await getServiceClient();
  if (!client) throw new Error("Pocket billing state store unavailable");
  const { error } = await client.rpc("pocket_apply_subscription_state", {
    p_business_id: params.businessId,
    p_customer_id: params.stripeCustomerId,
    p_provider_event_id: params.eventId,
    p_provider_event_created_at: new Date(params.eventCreatedAt * 1000).toISOString(),
    p_items: params.items.map((item) => ({
      offer_key: item.offerKey,
      provider_subscription_id: item.providerSubscriptionId,
      provider_item_id: item.providerItemId,
      provider_price_id: item.providerPriceId,
      provider_status: item.providerStatus,
      period_start: item.periodStart ? new Date(item.periodStart * 1000).toISOString() : null,
      period_end: item.periodEnd ? new Date(item.periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: item.cancelAtPeriodEnd,
    })),
  });
  if (error) throw new Error("Unable to synchronize Pocket subscription state atomically");
}

export async function recordPocketCyclePack(params: {
  businessId: string;
  actorId: string;
  checkoutSessionId: string;
  paymentIntentId: string | null;
  providerEventId: string;
  providerEventCreatedAt: number;
}) {
  const client = await getServiceClient();
  if (!client) throw new Error("Pocket billing state store unavailable");
  const { error } = await client.rpc("pocket_record_cycle_pack", {
    p_business_id: params.businessId,
    p_actor_id: params.actorId,
    p_checkout_session_id: params.checkoutSessionId,
    p_payment_intent_id: params.paymentIntentId,
    p_provider_event_id: params.providerEventId,
    p_provider_event_created_at: new Date(params.providerEventCreatedAt * 1000).toISOString(),
  });
  if (error) throw new Error("Unable to apply the Pocket invoice pack");
}

export async function reservePocketCheckout(params: {
  businessId: string;
  actorId: string;
  offerKey: PocketOfferKey;
  idempotencyKey: string;
}) {
  const client = await getServiceClient();
  if (!client) throw new Error("Pocket billing state store unavailable");
  const { data, error } = await client.rpc("pocket_reserve_checkout", {
    p_business_id: params.businessId,
    p_actor_id: params.actorId,
    p_offer_key: params.offerKey,
    p_idempotency_key: params.idempotencyKey,
  });
  if (error || !data) throw new Error(error?.message ?? "Unable to reserve Pocket checkout");
  const value = (Array.isArray(data) ? data[0] : data) as { reservation_id?: unknown; cycle_start?: unknown; cycle_end?: unknown };
  if (typeof value?.reservation_id !== "string") throw new Error("Unable to reserve Pocket checkout");
  return {
    reservation_id: value.reservation_id,
    cycle_start: typeof value.cycle_start === "string" ? value.cycle_start : null,
    cycle_end: typeof value.cycle_end === "string" ? value.cycle_end : null,
  };
}

export async function attachPocketCheckoutSession(reservationId: string, checkoutSessionId: string) {
  const client = await getServiceClient();
  if (!client) throw new Error("Pocket billing state store unavailable");
  const { error } = await client.rpc("pocket_attach_checkout_session", {
    p_reservation_id: reservationId,
    p_checkout_session_id: checkoutSessionId,
  });
  if (error) throw new Error("Unable to persist Pocket checkout reservation");
}

export async function getPocketStripeCustomerId(businessId: string): Promise<string | null> {
  const client = await getServiceClient();
  if (!client) throw new Error("Pocket billing state store unavailable");
  const { data, error } = await client.from("workspace_commercial_states")
    .select("stripe_customer_id")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw new Error("Unable to resolve Pocket billing customer");
  return (data as { stripe_customer_id: string | null } | null)?.stripe_customer_id ?? null;
}
