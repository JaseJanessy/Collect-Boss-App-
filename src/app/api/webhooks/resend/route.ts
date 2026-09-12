import { NextRequest, NextResponse } from "next/server";
import { extractReplyActivityId, providerStatusForEvent } from "@/lib/email/model";
import { getEmailProvider, verifyResendWebhook } from "@/lib/email/provider";
import { getServiceClient } from "@/lib/supabase/service-client";
import type { CommunicationActivityRow, Json } from "@/lib/supabase/types";
import { suppressEmailRecipient } from "@/lib/email/suppression";
import { recordIntegrationHealth } from "@/lib/integrations/queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ResendEvent {
  type: string;
  created_at: string;
  data: {
    email_id?: string;
    from?: string;
    to?: string[];
    cc?: string[];
    bcc?: string[];
    subject?: string;
    message_id?: string;
    bounce?: { message?: string };
    error?: string;
  };
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const payload = await request.text();
  let verified = false;
  try {
    verified = verifyResendWebhook({
      payload,
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Email webhook verification is unavailable." }, 503);
  }
  if (!verified) return json({ error: "Invalid webhook signature." }, 400);
  let event: ResendEvent;
  try { event = JSON.parse(payload) as ResendEvent; }
  catch { return json({ error: "Invalid webhook JSON." }, 400); }
  if (!event?.type || !event.data || typeof event.data !== "object") return json({ error: "Invalid webhook event." }, 400);
  const eventId = request.headers.get("svix-id")!;
  const service = await getServiceClient();
  if (!service) return json({ error: "Email webhook persistence is unavailable." }, 503);
  const messageId = typeof event.data.email_id === "string" ? event.data.email_id : null;
  const { data: insertedReceipt, error: receiptError } = await service.from("email_webhook_events").insert({
    provider: "resend",
    provider_event_id: eventId,
    event_type: event.type,
    provider_message_id: messageId,
    communication_activity_id: null,
    payload: {
      event_type: event.type,
      provider_message_id: messageId,
      provider_created_at: event.created_at,
    } as Json,
    status: "processing",
    event_created_at: event.created_at || null,
  }).select("id,communication_activity_id").maybeSingle();
  let receipt = insertedReceipt;
  if (receiptError || !receipt) {
    const { data: duplicate } = await service.from("email_webhook_events").select("id,communication_activity_id,status")
      .eq("provider", "resend").eq("provider_event_id", eventId).maybeSingle();
    if (!duplicate) return json({ error: "Unable to persist webhook receipt." }, 503);
    if (["processed", "ignored"].includes(duplicate.status)) return json({ received: true, duplicate: true });
    receipt = duplicate;
  }

  if (event.type === "email.received" && messageId) {
    const recipients = [...(event.data.to ?? []), ...(event.data.cc ?? []), ...(event.data.bcc ?? [])];
    const outboundId = extractReplyActivityId(recipients);
    const { data: outboundData } = outboundId
      ? await service.from("communication_activities").select("*")
        .eq("id", outboundId).eq("channel", "email").eq("direction", "outbound").maybeSingle()
      : { data: null };
    const outbound = outboundData as CommunicationActivityRow | null;
    if (outbound) {
      const { data: identity } = await service.from("email_sender_identities").select("reply_domain")
        .eq("business_id", outbound.business_id).maybeSingle();
      const expected = identity?.reply_domain ? `reply+${outbound.id}@${identity.reply_domain}`.toLowerCase() : null;
      const routed = expected && recipients.some((value) => {
        const normalized = value.toLowerCase().replace(/^.*</, "").replace(/>.*$/, "").trim();
        return normalized === expected;
      });
      if (routed) {
        const content = await getEmailProvider("resend").retrieveInbound(messageId).catch(() => ({ text: null, html: null, headers: {} }));
        const occurredAt = event.created_at || new Date().toISOString();
        const inboundId = crypto.randomUUID();
        const { data: inbound, error: inboundError } = await service.from("communication_activities").insert({
          id: inboundId,
          business_id: outbound.business_id,
          customer_id: outbound.customer_id,
          case_id: outbound.case_id,
          channel: "email",
          direction: "inbound",
          status: "replied",
          started_at: occurredAt,
          completed_at: occurredAt,
          provider: "resend",
          provider_message_id: messageId,
          external_reference: messageId,
          thread_reference: event.data.message_id ?? outbound.thread_reference ?? outbound.provider_message_id,
          sender: event.data.from ?? null,
          recipients: { to: event.data.to ?? [], cc: event.data.cc ?? [], bcc: event.data.bcc ?? [] },
          subject: event.data.subject ?? null,
          body_text: content.text,
          replied_at: occurredAt,
          review_required: true,
          idempotency_key: crypto.randomUUID(),
          metadata: { source: "provider_inbound", reply_to_activity_id: outbound.id, provider_headers: content.headers },
        } as never).select("*").single();
        if (inboundError || !inbound) {
          const { data: existingInbound } = await service.from("communication_activities").select("id")
            .eq("provider", "resend").eq("provider_message_id", messageId).maybeSingle();
          if (existingInbound) {
            await service.from("email_webhook_events").update({ communication_activity_id: existingInbound.id, status: "processed", processed_at: new Date().toISOString(), last_error_code: null, last_error_message: null } as never).eq("id", receipt.id);
            return json({ received: true, linked: true, duplicate: true });
          }
          return json({ error: "Unable to persist inbound email." }, 503);
        }
        await service.from("communication_activities").update({
          status: "replied", replied_at: occurredAt, completed_at: occurredAt,
        } as never).eq("id", outbound.id).eq("business_id", outbound.business_id);
        const sourceVersion = eventId;
        const { data: domainEvent } = await service.from("domain_events").insert({
          business_id: outbound.business_id,
          case_id: outbound.case_id,
          customer_id: outbound.customer_id,
          account_id: null,
          obligation_id: null,
          event_type: "EMAIL_REPLY_RECEIVED",
          source_entity_type: "communication_activity",
          source_entity_id: inbound.id,
          source_version: sourceVersion,
          effective_date: occurredAt.slice(0, 10),
          event_timezone: "UTC",
          occurred_at: occurredAt,
          event_status: "acknowledged",
          resolved_at: null,
          payload: { subject: event.data.subject ?? null, review_required: true },
          deduplication_key: `${outbound.business_id}:EMAIL_REPLY_RECEIVED:communication_activity:${inbound.id}:${sourceVersion}`,
        } as never).select("id").single();
        if (domainEvent) {
          const href = `/cases/${outbound.case_id}`;
          await service.from("notifications").insert({
            business_id: outbound.business_id,
            case_id: outbound.case_id,
            customer_id: outbound.customer_id,
            user_id: null,
            type: "EMAIL_REPLY_RECEIVED",
            event_type: "EMAIL_REPLY_RECEIVED",
            title: "Customer email reply needs review",
            message: "A customer replied to a recovery email. Review the reply before recording a promise or dispute.",
            entity_type: "communication_activity",
            entity_id: inbound.id,
            severity: "medium",
            action_url: href,
            read_at: null,
            archived_at: null,
            dedupe_key: `domain-event:${domainEvent.id}`,
            domain_event_id: domainEvent.id,
          } as never);
          const { data: actionItem } = await service.from("action_centre_items").insert({
            business_id: outbound.business_id,
            case_id: outbound.case_id,
            customer_id: outbound.customer_id,
            assignee_id: null,
            type: "review_email_reply",
            title: "Review customer email reply",
            description: "Read the reply and record any verified promise, dispute, or follow-up manually.",
            reason: "A provider-backed inbound reply was received.",
            href,
            entity_type: "communication_activity",
            entity_id: inbound.id,
            status: "open",
            amount_minor: 0,
            priority: "medium",
            due_at: occurredAt,
            recommended_action: "Review email reply",
            source_event_id: domainEvent.id,
            completed_at: null,
            snoozed_until: null,
            dedupe_key: `domain-event:${domainEvent.id}`,
          } as never).select("id").maybeSingle();
          if (actionItem) {
            await service.from("action_centre_item_events").insert({
              action_item_id: actionItem.id,
              business_id: outbound.business_id,
              case_id: outbound.case_id,
              actor_type: "system",
              actor_id: null,
              event_type: "created",
              from_status: null,
              to_status: "open",
              snooze_duration_seconds: null,
              metadata: { domain_event_id: domainEvent.id, source: "email_reply" },
            } as never);
          }
        }
        await service.from("email_webhook_events").update({ communication_activity_id: inbound.id, status: "processed", processed_at: new Date().toISOString(), last_error_code: null, last_error_message: null } as never).eq("id", receipt.id);
        return json({ received: true, linked: true });
      }
    }

    const recipientDomains = recipients.map((value) => value.replace(/^.*@/, "").replace(/[>\s].*$/, "").toLowerCase());
    const { data: identities } = await service.from("email_sender_identities").select("business_id,reply_domain")
      .in("reply_domain", recipientDomains);
    const businessId = identities?.length === 1 ? identities[0].business_id : null;
    if (businessId) {
      await service.from("email_inbound_reviews").insert({
        business_id: businessId,
        provider: "resend",
        provider_message_id: messageId,
        sender: event.data.from ?? "unknown",
        recipients: { to: event.data.to ?? [], cc: event.data.cc ?? [], bcc: event.data.bcc ?? [] },
        subject: event.data.subject ?? null,
        reason: "Inbound email could not be safely linked to a case. Manual review is required.",
        status: "pending",
        communication_activity_id: null,
      });
    }
    await service.from("email_webhook_events").update({ status: "processed", processed_at: new Date().toISOString(), last_error_code: null, last_error_message: null } as never).eq("id", receipt.id);
    return json({ received: true, linked: false });
  }

  const status = providerStatusForEvent(event.type);
  if (!status || !messageId) {
    await service.from("email_webhook_events").update({ status: "ignored", processed_at: new Date().toISOString() } as never).eq("id", receipt.id);
    return json({ received: true, ignored: true });
  }
  const { data: activityData } = await service.from("communication_activities").select("*")
    .eq("provider", "resend").eq("provider_message_id", messageId).maybeSingle();
  const activity = activityData as CommunicationActivityRow | null;
  if (!activity) {
    await service.from("email_webhook_events").update({
      status: "retry_scheduled", attempts: 2, last_error_code: "ACTIVITY_NOT_READY",
      last_error_message: "Email activity is not available for this provider event yet.",
    } as never).eq("id", receipt.id);
    return json({ error: "Email activity is not available for this provider event yet." }, 503);
  }
  const at = event.created_at || new Date().toISOString();
  const update: Record<string, unknown> = {};
  if (event.type === "email.sent") { update.sent_at = activity.sent_at ?? at; if (activity.status === "initiated") update.status = "sent"; }
  if (event.type === "email.delivered") {
    update.delivered_at = activity.delivered_at ?? at;
    if (["initiated", "sent"].includes(activity.status)) update.status = "delivered";
  }
  if (event.type === "email.opened") {
    update.opened_at = activity.opened_at ?? at;
    if (!["replied", "failed"].includes(activity.status)) update.status = "read";
  }
  if (status === "failed") {
    update.status = "failed";
    update.completed_at = at;
    update.failure_reason = event.data.bounce?.message ?? event.data.error ?? event.type.replace("email.", "");
  }
  const { error: updateError } = await service.from("communication_activities").update(update as never)
    .eq("id", activity.id).eq("business_id", activity.business_id);
  if (updateError) return json({ error: "Unable to persist email provider status." }, 503);
  if (["email.bounced", "email.suppressed", "email.complained"].includes(event.type)) {
    const eventRecipients = event.data.to?.length ? event.data.to : (() => {
      const recipients = activity.recipients && typeof activity.recipients === "object" && !Array.isArray(activity.recipients)
        ? activity.recipients as Record<string, unknown> : {};
      return Array.isArray(recipients.to) ? recipients.to.filter((value): value is string => typeof value === "string") : [];
    })();
    for (const recipient of eventRecipients) {
      await suppressEmailRecipient({
        client: service, businessId: activity.business_id, recipient,
        reason: event.type === "email.bounced" ? "bounce" : event.type === "email.complained" ? "complaint" : "provider_suppression", sourceEventId: eventId,
      }).catch(() => undefined);
    }
  }
  if (event.type === "email.bounced" && activity.customer_id) {
    const { data: preference } = await service.from("contact_preferences").select("id")
      .eq("business_id", activity.business_id).eq("customer_id", activity.customer_id).maybeSingle();
    if (preference) {
      await service.from("contact_preferences").update({ email_invalid: true, last_email_bounced_at: at } as never).eq("id", preference.id);
    } else {
      await service.from("contact_preferences").insert({
        business_id: activity.business_id, customer_id: activity.customer_id,
        email_invalid: true, last_email_bounced_at: at,
      } as never);
    }
  }
  await service.from("email_webhook_events").update({
    communication_activity_id: activity.id, status: "processed", processed_at: new Date().toISOString(),
    last_error_code: null, last_error_message: null,
  } as never).eq("id", receipt.id);
  await recordIntegrationHealth({
    businessId: activity.business_id, provider: "resend", succeeded: status !== "failed",
    errorCode: status === "failed" ? "EMAIL_DELIVERY_FAILURE" : null,
    actionableMessage: status === "failed" ? "Email delivery failed. The recipient may be suppressed; review delivery status before retrying." : null,
    metadata: { activityId: activity.id, eventType: event.type },
  }).catch(() => undefined);
  return json({ received: true, updated: true });
}
