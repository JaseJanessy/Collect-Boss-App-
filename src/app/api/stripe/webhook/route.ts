/** Stripe webhook: verify raw body, atomically claim, apply current provider truth. */
import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { claimBillingEvent, completeBillingEvent, failBillingEvent } from "@/lib/billing/service";
import { processStripeEvent } from "@/lib/billing/stripe-events";
import { enqueueIntegrationJob, recordIntegrationHealth, safeIntegrationError } from "@/lib/integrations/queue";
import { getStripeServer, isStripeConfigured } from "@/lib/stripe/server";

export const dynamic = "force-dynamic";
const MAX_WEBHOOK_BODY_BYTES = 1_000_000;
const ok = () => NextResponse.json({ received: true }, { status: 200 });
const fail = (status: number, message: string) => NextResponse.json({ error: message }, { status });

export async function POST(request: NextRequest) {
  if (!isStripeConfigured || !process.env.STRIPE_WEBHOOK_SECRET) return fail(503, "Webhook service is unavailable.");
  const declaredSize = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredSize) && declaredSize > MAX_WEBHOOK_BODY_BYTES) return fail(413, "Webhook payload is too large.");
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BODY_BYTES) return fail(413, "Webhook payload is too large.");
  const signature = request.headers.get("stripe-signature");
  if (!signature) return fail(400, "Invalid webhook request.");
  const stripe = getStripeServer();
  if (!stripe) return fail(503, "Webhook service is unavailable.");
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    console.warn("[stripe-webhook] signature_verification_failed");
    return fail(400, "Invalid webhook request.");
  }
  let claim: Awaited<ReturnType<typeof claimBillingEvent>>;
  try {
    claim = await claimBillingEvent({
      stripeEventId: event.id, eventType: event.type,
      stripeEventCreatedAt: typeof event.created === "number" ? event.created : null,
    });
  } catch {
    console.error("[stripe-webhook] event_claim_failed", { eventId: event.id, eventType: event.type });
    return fail(500, "Webhook processing failed. Please retry.");
  }
  if (claim === "done" || claim === "busy") {
    console.info("[stripe-webhook] duplicate_ignored", { eventId: event.id, eventType: event.type });
    return ok();
  }
  try {
    const result = await processStripeEvent(event, stripe);
    await completeBillingEvent({ businessId: result.businessId, stripeEventId: event.id, eventType: event.type, outcome: result.outcome });
    if (result.businessId) await recordIntegrationHealth({
      businessId: result.businessId, provider: "stripe", succeeded: true,
      metadata: { eventId: event.id, eventType: event.type },
    }).catch(() => undefined);
    console.info("[stripe-webhook] event_processed", { eventId: event.id, eventType: event.type, claim, outcome: result.outcome });
    return ok();
  } catch (error) {
    const safeError = safeIntegrationError(error);
    await failBillingEvent({ stripeEventId: event.id, errorCode: "STRIPE_EVENT_PROCESSING_FAILED", errorMessage: safeError }).catch(() => undefined);
    await enqueueIntegrationJob({
      provider: "stripe", jobType: "stripe_event_replay", businessId: null,
      resourceId: event.id, operationKey: event.id, payload: { eventId: event.id },
    }).catch(() => undefined);
    console.error("[stripe-webhook] event_processing_failed", { eventId: event.id, eventType: event.type, claim });
    return fail(500, "Webhook processing failed. Please retry.");
  }
}
