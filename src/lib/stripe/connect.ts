import "server-only";

import type Stripe from "stripe";
import type { AppSupabaseClient } from "@/lib/supabase/client";
import type { BusinessPaymentConnectionRow } from "@/lib/supabase/types";
import { getStripeServer } from "./server";

/**
 * Stripe Connect for debtor payments. Businesses connect their own Standard
 * account and every debtor payment is a direct charge on that account.
 */

export const MIN_ONLINE_PAYMENT_MINOR = 200; // RM2.00: below this, card/FPX fees are disproportionate.

export function connectConfigured(): boolean {
  return Boolean(getStripeServer()) && Boolean(process.env.STRIPE_CONNECT_WEBHOOK_SECRET?.trim());
}

export async function loadConnection(service: AppSupabaseClient, businessId: string) {
  const { data, error } = await service.from("business_payment_connections").select("*")
    .eq("business_id", businessId).is("disconnected_at", null).maybeSingle();
  if (error) throw new Error("Payment connection is unavailable.");
  return data as BusinessPaymentConnectionRow | null;
}

export function connectionFlags(account: Stripe.Account) {
  return {
    charges_enabled: Boolean(account.charges_enabled),
    payouts_enabled: Boolean(account.payouts_enabled),
    details_submitted: Boolean(account.details_submitted),
  };
}

/** Pulls the latest account state from Stripe into our record. */
export async function refreshConnection(service: AppSupabaseClient, connection: BusinessPaymentConnectionRow) {
  const stripe = getStripeServer();
  if (!stripe) throw new Error("Stripe is not configured.");
  const account = await stripe.accounts.retrieve(connection.stripe_account_id);
  const flags = connectionFlags(account);
  await service.from("business_payment_connections").update({ ...flags, updated_at: new Date().toISOString() })
    .eq("business_id", connection.business_id);
  return { ...connection, ...flags };
}

/** Maps Stripe's payment method type to our payment method label. */
export function onlinePaymentMethod(type: string | null | undefined): "online_fpx" | "online_card" | "online_other" {
  if (type === "fpx") return "online_fpx";
  if (type === "card") return "online_card";
  return "online_other";
}

/** Records a completed Checkout Session from a connected account (idempotent). */
export async function recordCheckoutSession(service: AppSupabaseClient, session: Stripe.Checkout.Session, accountId: string) {
  if (session.payment_status !== "paid") return { recorded: false as const, reason: "not_paid" };
  const stripe = getStripeServer();
  if (!stripe) throw new Error("Stripe is not configured.");
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!paymentIntentId || session.amount_total === null || !session.currency) throw new Error("Checkout session is missing payment details.");
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] }, { stripeAccount: accountId });
  const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  const { data, error } = await service.rpc("online_payment_record", {
    p_checkout_session_id: session.id,
    p_stripe_account_id: accountId,
    p_payment_intent_id: paymentIntentId,
    p_amount_minor: session.amount_total,
    p_currency: session.currency.toUpperCase(),
    p_payment_method: onlinePaymentMethod(charge?.payment_method_details?.type),
  });
  if (error || !data) throw new Error("Online payment could not be recorded.");
  return { recorded: true as const, paymentId: data as string };
}
