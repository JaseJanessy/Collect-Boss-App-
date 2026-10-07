import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/client";
import { sendWhatsAppTemplate, whatsappConfig, WhatsAppProviderError, type WhatsAppLanguage, type WhatsAppTemplateKind } from "./cloud-api";
import { isWithinSendWindow, reminderSkipReason } from "./policy";

/** Leave headroom inside the hourly job's time limit; the rest waits for the next run. */
const SEND_BUDGET_MS = 120_000;
const RETRY_BACKOFF_MS = 15 * 60_000;

type QueuedMessage = {
  id: string;
  business_id: string;
  customer_id: string | null;
  obligation_id: string | null;
  to_phone_e164: string;
  template_kind: WhatsAppTemplateKind;
  language: WhatsAppLanguage;
  variables: string[];
  attempts: number;
};

export interface WhatsAppRunResult {
  configured: boolean;
  queued: number;
  sent: number;
  skipped: number;
  failed: number;
  deferred: boolean;
}

/**
 * Queues today's due reminders, then sends what is due inside the Malaysian
 * daytime window. Outside the window messages stay queued for the next run.
 */
export async function processWhatsAppReminders(service: AppSupabaseClient, now = new Date()): Promise<WhatsAppRunResult> {
  const result: WhatsAppRunResult = { configured: whatsappConfig().configured, queued: 0, sent: 0, skipped: 0, failed: 0, deferred: false };
  if (!result.configured) return result;

  const { data: queuedData, error: queueError } = await service.rpc("whatsapp_enqueue_due_reminders", { p_now: now.toISOString() });
  if (queueError) throw new Error("WhatsApp reminders could not be queued.");
  result.queued = Number((queuedData as { queued?: number } | null)?.queued ?? 0);

  if (!isWithinSendWindow(now)) {
    result.deferred = true;
    return result;
  }

  const deadline = Date.now() + SEND_BUDGET_MS;
  while (Date.now() < deadline) {
  const { data: claimed, error: claimError } = await service.rpc("whatsapp_claim_messages", { p_limit: 50 });
  if (claimError) throw new Error("WhatsApp reminders could not be claimed.");
  const batch = (claimed ?? []) as QueuedMessage[];
  if (batch.length === 0) break;

  for (const message of batch) {
    let skip: string | null;
    try {
      skip = await skipReasonFor(service, message);
    } catch {
      // Checks unavailable: leave it queued for the next run rather than guess.
      await service.from("whatsapp_messages").update({ status: "queued", lease_expires_at: new Date(Date.now() + RETRY_BACKOFF_MS).toISOString(), updated_at: new Date().toISOString() }).eq("id", message.id);
      continue;
    }
    if (skip) {
      await service.from("whatsapp_messages").update({ status: "skipped", skip_reason: skip, lease_expires_at: null, updated_at: new Date().toISOString() }).eq("id", message.id);
      result.skipped += 1;
      continue;
    }
    try {
      const { messageId } = await sendWhatsAppTemplate({
        to: message.to_phone_e164,
        kind: message.template_kind,
        language: message.language,
        bodyParameters: message.variables.map(String),
      });
      await service.from("whatsapp_messages").update({
        status: "sent", provider_message_id: messageId, sent_at: new Date().toISOString(),
        lease_expires_at: null, error_code: null, error_message: null, updated_at: new Date().toISOString(),
      }).eq("id", message.id);
      result.sent += 1;
    } catch (error) {
      const providerError = error instanceof WhatsAppProviderError ? error : null;
      const retry = Boolean(providerError?.retryable) && message.attempts < 3;
      await service.from("whatsapp_messages").update({
        status: retry ? "queued" : "failed",
        error_code: providerError?.code ?? "UNKNOWN",
        error_message: (providerError?.message ?? "Sending failed.").slice(0, 300),
        // Retry no sooner than the back-off; the claim query skips it until then.
        lease_expires_at: retry ? new Date(Date.now() + RETRY_BACKOFF_MS).toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq("id", message.id);
      if (!retry) result.failed += 1;
    }
  }
  }
  return result;
}

async function skipReasonFor(service: AppSupabaseClient, message: QueuedMessage): Promise<string | null> {
  const [optOut, preferences, obligation] = await Promise.all([
    service.from("whatsapp_opt_outs").select("phone_e164").eq("phone_e164", message.to_phone_e164).maybeSingle(),
    message.customer_id
      ? service.from("contact_preferences").select("email_only,wrong_number,invalid_contact")
        .eq("business_id", message.business_id).eq("customer_id", message.customer_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    message.obligation_id
      ? service.from("obligations").select("outstanding_minor,status,archived_at").eq("id", message.obligation_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (optOut.error || preferences.error || obligation.error) throw new Error("Reminder checks are unavailable.");
  const row = obligation.data as { outstanding_minor: number; status: string; archived_at: string | null } | null;
  return reminderSkipReason({
    optedOut: Boolean(optOut.data),
    preferences: preferences.data as { email_only?: boolean; wrong_number?: boolean; invalid_contact?: boolean } | null,
    outstandingMinor: row && !row.archived_at ? Number(row.outstanding_minor) : null,
    obligationStatus: row?.status ?? null,
  });
}
