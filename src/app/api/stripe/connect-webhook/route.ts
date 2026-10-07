/**
 * Stripe Connect webhook (events from connected business accounts).
 * Authenticated with STRIPE_CONNECT_WEBHOOK_SECRET over the raw body.
 *
 * - account.updated                       → refresh charges/payouts flags
 * - checkout.session.completed /
 *   checkout.session.async_payment_succeeded → record the paid debtor payment once
 * - checkout.session.async_payment_failed /
 *   checkout.session.expired              → mark the session closed
 */
import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { connectionFlags, recordCheckoutSession } from "@/lib/stripe/connect";
import { getStripeServer } from "@/lib/stripe/server";
import { getServiceClient } from "@/lib/supabase/service-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 1_000_000;
const fail = (status: number, message: string) => NextResponse.json({ error: message }, { status });

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET?.trim();
  const stripe = getStripeServer();
  if (!secret || !stripe) return fail(503, "Webhook service is unavailable.");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return fail(413, "Webhook payload is too large.");
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) return fail(400, "Invalid webhook request.");

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    return fail(400, "Invalid webhook request.");
  }
  const accountId = event.account;
  if (!accountId) return NextResponse.json({ received: true, ignored: "platform_event" });

  const service = await getServiceClient();
  if (!service) return fail(503, "Webhook service is unavailable.");

  try {
    if (event.type === "account.updated") {
      const account = event.data.object as Stripe.Account;
      await service.from("business_payment_connections")
        .update({ ...connectionFlags(account), updated_at: new Date().toISOString() })
        .eq("stripe_account_id", accountId);
    } else if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      // Only sessions CollectBoss created are recorded; anything else on the account is ignored.
      const { data: known } = await service.from("online_payment_sessions").select("id").eq("checkout_session_id", session.id).maybeSingle();
      if (known) await recordCheckoutSession(service, session, accountId);
    } else if (event.type === "checkout.session.async_payment_failed" || event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      await service.from("online_payment_sessions")
        .update({ status: event.type === "checkout.session.expired" ? "expired" : "failed", updated_at: new Date().toISOString() })
        .eq("checkout_session_id", session.id).eq("status", "open");
    }
  } catch {
    console.error("[connect-webhook] processing_failed", { eventId: event.id, type: event.type });
    // Non-2xx makes Stripe retry; recording is idempotent.
    return fail(500, "Webhook processing failed. Please retry.");
  }
  return NextResponse.json({ received: true });
}
