import "server-only";

import { Buffer } from "node:buffer";
import { evaluateContactGuard, type ContactGuardContext } from "@/lib/communications/guardrails";
import type { AppSupabaseClient } from "@/lib/supabase/client";
import type {
  CommunicationActivityRow,
  ContactFrequencyPolicy,
  ContactPreferenceRow,
  EmailSenderIdentityRow,
  EmailTemplateRow,
  EvidenceFileRow,
  Json,
  ScheduledEmailFollowupRow,
} from "@/lib/supabase/types";
import { DEFAULT_EMAIL_TEMPLATES, emailBlockedReason } from "./model";
import { EmailProviderError, getEmailProvider, type ProviderAttachment } from "./provider";
import { requireExecutableComplianceCheck } from "@/lib/compliance/service";
import { assertRecipientsNotSuppressed } from "./suppression";
import { enqueueIntegrationJob, recordIntegrationHealth } from "@/lib/integrations/queue";

const EVIDENCE_BUCKET = "case-evidence";

export class CaseEmailError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export interface CaseEmailInput {
  businessId: string;
  caseId: string;
  actorId: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyText: string;
  attachmentIds: string[];
  relatedActionId: string | null;
  idempotencyKey: string;
  overrideReason?: string;
  allowRetry?: boolean;
  policyCheckId?: string | null;
  bulk?: boolean;
}

const defaultPolicy: ContactFrequencyPolicy = {
  max_attempts_24h: 2,
  max_attempts_7d: 5,
  max_attempts_30d: 12,
  frequency_mode: "warn",
  preference_mode: "require_override",
  bulk_mode: "exclude",
};

export async function ensureDefaultEmailTemplates(client: AppSupabaseClient, businessId: string, actorId: string) {
  const { data: existing, error } = await client.from("email_templates").select("name").eq("business_id", businessId);
  if (error) throw new CaseEmailError("Unable to load email templates.", 503);
  const names = new Set((existing ?? []).map((row) => row.name));
  const missing = DEFAULT_EMAIL_TEMPLATES.filter((template) => !names.has(template.name));
  if (missing.length) {
    const { error: insertError } = await client.from("email_templates").insert(missing.map((template) => ({
      business_id: businessId,
      ...template,
      is_active: true,
      is_system_default: true,
      created_by: actorId,
      updated_by: actorId,
    })));
    if (insertError) throw new CaseEmailError("Unable to initialize email templates.", 503);
  }
}

async function loadGuardContext(client: AppSupabaseClient, businessId: string, caseId: string): Promise<ContactGuardContext> {
  const { data: caseData, error: caseError } = await client.from("cases")
    .select("id,debtor_id").eq("business_id", businessId).eq("id", caseId).maybeSingle();
  if (caseError) throw new CaseEmailError("Unable to load case.", 503);
  if (!caseData) throw new CaseEmailError("Case not found.", 404);
  const [{ data: business }, { data: preference }, { data: policy }, { data: activities }] = await Promise.all([
    client.from("businesses").select("timezone").eq("id", businessId).maybeSingle(),
    caseData.debtor_id
      ? client.from("contact_preferences").select("*").eq("business_id", businessId).eq("customer_id", caseData.debtor_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    client.from("contact_frequency_policies").select("*").eq("business_id", businessId).maybeSingle(),
    client.from("communication_activities").select("started_at").eq("business_id", businessId)
      .eq("direction", "outbound")
      .gte("started_at", new Date(Date.now() - 30 * 86400000).toISOString())
      .eq(caseData.debtor_id ? "customer_id" : "case_id", caseData.debtor_id ?? caseId),
  ]);
  const now = Date.now();
  const attempts = (activities ?? []).map((row) => new Date(row.started_at).getTime());
  return {
    case_id: caseId,
    customer_id: caseData.debtor_id,
    timezone: business?.timezone ?? "Asia/Kuala_Lumpur",
    counts: {
      attempts_24h: attempts.filter((at) => at >= now - 86400000).length,
      attempts_7d: attempts.filter((at) => at >= now - 7 * 86400000).length,
      attempts_30d: attempts.length,
    },
    policy: policy ? {
      max_attempts_24h: policy.max_attempts_24h,
      max_attempts_7d: policy.max_attempts_7d,
      max_attempts_30d: policy.max_attempts_30d,
      frequency_mode: policy.frequency_mode,
      preference_mode: policy.preference_mode,
      bulk_mode: policy.bulk_mode,
    } : defaultPolicy,
    preferences: preference as ContactPreferenceRow | null,
  };
}

async function loadAttachments(
  client: AppSupabaseClient,
  businessId: string,
  caseId: string,
  attachmentIds: string[],
): Promise<{ provider: ProviderAttachment[]; evidence: EvidenceFileRow[] }> {
  if (!attachmentIds.length) return { provider: [], evidence: [] };
  const { data, error } = await client.from("evidence_files").select("*")
    .eq("case_id", caseId).eq("is_internal", false).is("archived_at", null).in("id", attachmentIds);
  if (error) throw new CaseEmailError("Unable to verify email attachments.", 503);
  const evidence = (data ?? []) as EvidenceFileRow[];
  if (evidence.length !== new Set(attachmentIds).size) {
    throw new CaseEmailError("One or more attachments are internal, archived, or outside this case.", 422);
  }
  let total = 0;
  const provider: ProviderAttachment[] = [];
  for (const file of evidence) {
    const path = file.object_path ?? file.file_url;
    if (!path) throw new CaseEmailError(`Attachment ${file.file_name} has no secure storage object.`, 422);
    total += file.file_size_bytes ?? 0;
    if (total > 10 * 1024 * 1024) throw new CaseEmailError("Email attachments must total 10 MB or less.", 422);
    const { data: blob, error: downloadError } = await client.storage.from(EVIDENCE_BUCKET).download(path);
    if (downloadError || !blob) throw new CaseEmailError(`Unable to read attachment ${file.file_name}.`, 503);
    provider.push({ filename: file.file_name, content: Buffer.from(await blob.arrayBuffer()).toString("base64") });
  }
  void businessId;
  return { provider, evidence };
}

export async function sendCaseEmail(client: AppSupabaseClient, input: CaseEmailInput) {
  const { data: caseData, error: caseError } = await client.from("cases").select("*")
    .eq("business_id", input.businessId).eq("id", input.caseId).maybeSingle();
  if (caseError) throw new CaseEmailError("Unable to load case.", 503);
  if (!caseData) throw new CaseEmailError("Case not found.", 404);
  if (caseData.archived_at || ["paid", "closed"].includes(caseData.status)) {
    throw new CaseEmailError("Closed, paid, or archived cases cannot send recovery email.", 409);
  }
  const primary = caseData.debtor_email?.trim().toLowerCase();
  if (!primary || !input.to.includes(primary)) {
    throw new CaseEmailError("The customer email address must remain in the To field.", 422);
  }
  const { data: identity, error: identityError } = await client.from("email_sender_identities").select("*")
    .eq("business_id", input.businessId).maybeSingle();
  if (identityError) throw new CaseEmailError("Unable to load sender identity.", 503);
  const sender = identity as EmailSenderIdentityRow | null;
  if (!sender || sender.verification_status !== "verified" || !sender.verified_at) {
    throw new CaseEmailError("Configure and verify an approved sender identity in Settings before sending email.", 409);
  }
  const context = await loadGuardContext(client, input.businessId, input.caseId);
  const blocked = emailBlockedReason(context.preferences);
  if (blocked) throw new CaseEmailError(blocked, 409);
  try {
    await assertRecipientsNotSuppressed(client, input.businessId, [...input.to, ...input.cc, ...input.bcc]);
  } catch (error) {
    throw new CaseEmailError(error instanceof Error ? error.message : "Email suppression status could not be checked.", 409);
  }
  const guardrail = evaluateContactGuard(context, "email");
  if (guardrail.requires_override && (!input.overrideReason || input.overrideReason.trim().length < 3)) {
    throw new CaseEmailError(`${guardrail.warnings.join(" ")} A short override reason is required.`, 409);
  }
  const { data: business } = await client.from("businesses").select("country_code")
    .eq("id", input.businessId).maybeSingle();
  const compliance = await requireExecutableComplianceCheck(client, {
    businessId: input.businessId,
    caseId: input.caseId,
    actorId: input.actorId,
    jurisdiction: business?.country_code ?? "MY",
    actionKind: "communication",
    channel: "email",
    subject: input.subject,
    bodyText: input.bodyText,
    recipients: [...input.to, ...input.cc, ...input.bcc],
    bulk: input.bulk,
  }, input.policyCheckId);

  const activityId = crypto.randomUUID();
  const recipients = { to: input.to, cc: input.cc, bcc: input.bcc } as Json;
  const { data: created, error: createError } = await client.from("communication_activities").insert({
    id: activityId,
    business_id: input.businessId,
    customer_id: caseData.debtor_id,
    case_id: input.caseId,
    channel: "email",
    direction: "outbound",
    status: "initiated",
    staff_user_id: input.actorId,
    provider: sender.provider,
    sender: `${sender.from_name} <${sender.from_email}>`,
    recipients,
    subject: input.subject,
    body_text: input.bodyText,
    related_action_id: input.relatedActionId,
    idempotency_key: input.idempotencyKey,
    metadata: { source: "email_2", attachment_ids: input.attachmentIds },
    policy_check_id: compliance.check.id,
    policy_content_hash: compliance.contentHash,
  } as never).select("*").single();
  let activity = created as CommunicationActivityRow | null;
  if (createError) {
    const { data: existing } = await client.from("communication_activities").select("*")
      .eq("business_id", input.businessId).eq("idempotency_key", input.idempotencyKey).maybeSingle();
    if (existing?.provider_message_id) return existing as CommunicationActivityRow;
    if (existing && input.allowRetry) activity = existing as CommunicationActivityRow;
    else if (existing) throw new CaseEmailError("This email is already being processed.", 409);
    if (!existing) throw new CaseEmailError("Unable to create email activity.", 503);
  }
  if (!activity) throw new CaseEmailError("Unable to create email activity.", 503);
  try {
    const attachments = await loadAttachments(client, input.businessId, input.caseId, input.attachmentIds);
    const provider = getEmailProvider(sender.provider);
    const replyTo = sender.reply_domain ? `reply+${activity.id}@${sender.reply_domain}` : sender.from_email;
    const delivery = await provider.send({
      from: `${sender.from_name} <${sender.from_email}>`,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      text: input.bodyText,
      replyTo,
      attachments: attachments.provider,
      idempotencyKey: input.idempotencyKey,
    });
    const sentAt = new Date().toISOString();
    const { data: updated, error: updateError } = await client.from("communication_activities").update({
      status: "sent",
      provider_message_id: delivery.messageId,
      external_reference: delivery.messageId,
      thread_reference: delivery.messageId,
      sent_at: sentAt,
      metadata: { source: "email_2", attachment_ids: input.attachmentIds, reply_to: replyTo },
    } as never).eq("id", activity.id).eq("business_id", input.businessId).select("*").single();
    if (updateError || !updated) throw new CaseEmailError("Email was accepted by the provider but status persistence failed.", 503);
    if (guardrail.warnings.length) {
      await client.from("contact_guard_overrides").insert({
        business_id: input.businessId,
        customer_id: caseData.debtor_id,
        case_id: input.caseId,
        communication_activity_id: activity.id,
        action_item_id: input.relatedActionId,
        channel: "email",
        is_bulk: false,
        reason: input.overrideReason || "Continued under the configured warn-only contact policy.",
        evaluation: JSON.parse(JSON.stringify(guardrail)) as Json,
        overridden_by: input.actorId,
      } as never);
    }
    await recordIntegrationHealth({
      businessId: input.businessId, provider: "resend", succeeded: true,
      metadata: { activityId: activity.id },
    }).catch(() => undefined);
    return updated as CommunicationActivityRow;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 1000) : "Email provider request failed.";
    await client.from("communication_activities").update({
      status: "failed", completed_at: new Date().toISOString(), failure_reason: reason,
    } as never).eq("id", activity.id).eq("business_id", input.businessId);
    await recordIntegrationHealth({
      businessId: input.businessId, provider: "resend", succeeded: false,
      errorCode: error instanceof EmailProviderError ? "EMAIL_PROVIDER_FAILURE" : "EMAIL_DELIVERY_FAILURE",
      actionableMessage: "Email delivery failed and is queued for retry. Check sender verification and suppression status if retries continue.",
      metadata: { activityId: activity.id },
    }).catch(() => undefined);
    if (!input.allowRetry) {
      await enqueueIntegrationJob({
        provider: "resend", jobType: "email_delivery", businessId: input.businessId,
        resourceId: activity.id, operationKey: input.idempotencyKey, createdBy: input.actorId,
        payload: { activityId: activity.id },
      }).catch(() => undefined);
    }
    if (error instanceof CaseEmailError) throw error;
    if (error instanceof EmailProviderError) throw new CaseEmailError(error.message, 503);
    throw new CaseEmailError("Email delivery failed.", 503);
  }
}

function jsonStringArray(value: Json | undefined) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function retryFailedCaseEmail(client: AppSupabaseClient, businessId: string, activityId: string) {
  const { data, error } = await client.from("communication_activities").select("*")
    .eq("id", activityId).eq("business_id", businessId).eq("channel", "email").eq("direction", "outbound").maybeSingle();
  if (error || !data) throw new CaseEmailError("Failed email activity was not found.", 404);
  const activity = data as CommunicationActivityRow;
  if (activity.provider_message_id && ["sent", "delivered", "read", "replied"].includes(activity.status)) return activity;
  const recipients = activity.recipients && typeof activity.recipients === "object" && !Array.isArray(activity.recipients)
    ? activity.recipients as Record<string, Json | undefined> : {};
  const metadata = activity.metadata && typeof activity.metadata === "object" && !Array.isArray(activity.metadata)
    ? activity.metadata as Record<string, Json | undefined> : {};
  return sendCaseEmail(client, {
    businessId,
    caseId: activity.case_id,
    actorId: activity.staff_user_id,
    to: jsonStringArray(recipients.to),
    cc: jsonStringArray(recipients.cc),
    bcc: jsonStringArray(recipients.bcc),
    subject: activity.subject ?? "Payment account follow-up",
    bodyText: activity.body_text ?? "",
    attachmentIds: jsonStringArray(metadata.attachment_ids),
    relatedActionId: activity.related_action_id,
    idempotencyKey: activity.idempotency_key,
    allowRetry: true,
    policyCheckId: activity.policy_check_id,
  });
}

export async function processScheduledEmailFollowups(client: AppSupabaseClient, limit = 50) {
  const { data, error } = await client.from("scheduled_email_followups").select("*")
    .in("status", ["pending", "processing"]).lte("due_at", new Date().toISOString())
    .order("due_at").limit(limit);
  if (error) throw new CaseEmailError("Unable to load scheduled email follow-ups.", 503);
  const results = { sent: 0, failed: 0, skipped: 0 };
  for (const row of (data ?? []) as ScheduledEmailFollowupRow[]) {
    if (row.status === "processing" && row.attempts >= 3) { results.skipped += 1; continue; }
    const { data: claimed } = await client.from("scheduled_email_followups").update({
      status: "processing", attempts: row.attempts + 1,
    }).eq("id", row.id).eq("status", row.status).select("id").maybeSingle();
    if (!claimed) { results.skipped += 1; continue; }
    try {
      const activity = await sendCaseEmail(client, {
        businessId: row.business_id,
        caseId: row.case_id,
        actorId: row.created_by,
        to: row.to_recipients as string[],
        cc: row.cc_recipients as string[],
        bcc: row.bcc_recipients as string[],
        subject: row.subject,
        bodyText: row.body_text,
        attachmentIds: row.attachment_ids as string[],
        relatedActionId: row.related_action_id,
        idempotencyKey: row.idempotency_key,
        overrideReason: row.override_reason ?? undefined,
        allowRetry: true,
        policyCheckId: row.policy_check_id,
      });
      await client.from("scheduled_email_followups").update({
        status: "sent", communication_activity_id: activity.id, processed_at: new Date().toISOString(), last_error: null,
      }).eq("id", row.id);
      results.sent += 1;
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message.slice(0, 1000) : "Scheduled email failed.";
      await client.from("scheduled_email_followups").update({
        status: row.attempts + 1 >= 3 ? "failed" : "pending",
        last_error: message,
        processed_at: row.attempts + 1 >= 3 ? new Date().toISOString() : null,
      }).eq("id", row.id);
      results.failed += 1;
    }
  }
  return results;
}

export async function listEmailConfiguration(client: AppSupabaseClient, businessId: string, actorId: string) {
  await ensureDefaultEmailTemplates(client, businessId, actorId);
  const [{ data: identity }, { data: templates, error }, { data: health }, { data: suppressions }, { data: jobs }] = await Promise.all([
    client.from("email_sender_identities").select("*").eq("business_id", businessId).maybeSingle(),
    client.from("email_templates").select("*").eq("business_id", businessId).order("name"),
    client.from("integration_health").select("status,last_checked_at,last_success_at,last_failure_at,consecutive_failures,error_code,actionable_message")
      .eq("business_id", businessId).eq("provider", "resend").maybeSingle(),
    client.from("email_suppressions").select("id,masked_recipient,reason,created_at")
      .eq("business_id", businessId).eq("active", true).order("created_at", { ascending: false }).limit(20),
    client.from("integration_jobs").select("id,status,attempts,max_attempts,next_attempt_at,last_error_message,created_at")
      .eq("business_id", businessId).eq("provider", "resend").eq("job_type", "email_delivery")
      .in("status", ["retry_scheduled", "dead_letter"]).order("created_at", { ascending: false }).limit(20),
  ]);
  if (error) throw new CaseEmailError("Unable to load email configuration.", 503);
  return {
    identity: identity as EmailSenderIdentityRow | null,
    templates: (templates ?? []) as EmailTemplateRow[],
    health: health ?? null,
    suppressions: suppressions ?? [],
    jobs: jobs ?? [],
  };
}
