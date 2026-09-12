import "server-only";

import { syncAccountingConnection, type AccountingSyncMode } from "@/lib/accounting/sync";
import { completeBillingEvent, failBillingEvent } from "@/lib/billing/service";
import { processStripeEvent } from "@/lib/billing/stripe-events";
import { retryFailedCaseEmail } from "@/lib/email/service";
import { getStripeServer } from "@/lib/stripe/server";
import type { IntegrationJobRow, Json } from "@/lib/supabase/types";
import { claimIntegrationJobs, finishIntegrationJob, recordIntegrationHealth, safeIntegrationError } from "./queue";

function objectPayload(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Json | undefined> : {};
}

function text(value: Json | undefined, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

async function processJob(job: IntegrationJobRow, service: Awaited<ReturnType<typeof claimIntegrationJobs>>["service"]) {
  const payload = objectPayload(job.payload);
  if (job.job_type === "accounting_sync" || job.job_type === "accounting_webhook") {
    const connectionId = text(payload.connectionId, job.resource_id);
    const requestedMode = text(payload.mode, "incremental");
    const mode: AccountingSyncMode = requestedMode === "full" ? "full" : "incremental";
    await syncAccountingConnection(connectionId, mode, { enqueueFailure: false });
    if (job.job_type === "accounting_webhook") {
      const webhookEventKey = text(payload.webhookEventKey);
      if (webhookEventKey) {
        await service.from("accounting_webhook_events").update({
          status: "processed", processed_at: new Date().toISOString(), last_error: null, last_attempt_at: new Date().toISOString(),
        }).eq("provider", job.provider).eq("event_key", webhookEventKey).eq("connection_id", connectionId);
      }
    }
    return;
  }
  if (job.job_type === "email_delivery") {
    if (!job.business_id) throw new Error("Email retry has no tenant scope.");
    await retryFailedCaseEmail(service, job.business_id, text(payload.activityId, job.resource_id));
    return;
  }
  if (job.job_type === "stripe_event_replay") {
    const stripe = getStripeServer();
    if (!stripe) throw new Error("Stripe is not configured for this environment.");
    const eventId = text(payload.eventId, job.resource_id);
    const event = await stripe.events.retrieve(eventId);
    const result = await processStripeEvent(event, stripe);
    await completeBillingEvent({ businessId: result.businessId, stripeEventId: event.id, eventType: event.type, outcome: `replay:${result.outcome}` });
    if (result.businessId) await recordIntegrationHealth({
      businessId: result.businessId, provider: "stripe", succeeded: true,
      metadata: { eventId: event.id, replayed: true },
    }).catch(() => undefined);
    return;
  }
  throw new Error("Unsupported integration recovery job.");
}

export async function processIntegrationJobs(limit = 25) {
  const { service, jobs } = await claimIntegrationJobs(limit);
  const results: Array<{ id: string; status: IntegrationJobRow["status"]; error?: string }> = [];
  for (const job of jobs) {
    try {
      await processJob(job, service);
      const completed = await finishIntegrationJob({ jobId: job.id, succeeded: true });
      results.push({ id: job.id, status: completed.status });
    } catch (error) {
      const message = safeIntegrationError(error);
      const completed = await finishIntegrationJob({
        jobId: job.id, succeeded: false, errorCode: "INTEGRATION_JOB_FAILED", errorMessage: message,
      });
      if (job.job_type === "stripe_event_replay") {
        await failBillingEvent({ stripeEventId: job.resource_id, errorCode: "STRIPE_REPLAY_FAILED", errorMessage: message }).catch(() => undefined);
      }
      if (job.job_type === "accounting_webhook") {
        const webhookEventKey = text(objectPayload(job.payload).webhookEventKey);
        if (webhookEventKey) {
          await service.from("accounting_webhook_events").update({
            status: completed.status === "dead_letter" ? "dead_letter" : "retry_scheduled",
            attempts: completed.attempts, last_error: message, last_attempt_at: new Date().toISOString(),
            next_attempt_at: completed.next_attempt_at,
            dead_lettered_at: completed.status === "dead_letter" ? new Date().toISOString() : null,
          }).eq("provider", job.provider).eq("event_key", webhookEventKey);
        }
      }
      results.push({ id: job.id, status: completed.status, error: message });
    }
  }
  return results;
}
