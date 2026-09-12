import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantPermission } from "@/lib/auth/tenant-access";
import { evaluateContactGuard } from "@/lib/communications/guardrails";
import { loadContactGuardContexts } from "@/lib/communications/guard-server";
import { emailBlockedReason, renderEmailTemplate } from "@/lib/email/model";
import { CaseEmailError, listEmailConfiguration, sendCaseEmail } from "@/lib/email/service";
import type { CaseRow, EvidenceFileRow } from "@/lib/supabase/types";
import { formatCalendarDate, formatMinorCurrency } from "@/lib/international/formatting";
import { resolveRegionSettings } from "@/lib/international/registry";
import { ComplianceGateError, evaluationResponse, requireExecutableComplianceCheck } from "@/lib/compliance/service";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  action: z.enum(["send", "schedule"]),
  to: z.array(z.email().max(320)).min(1).max(10),
  cc: z.array(z.email().max(320)).max(10).default([]),
  bcc: z.array(z.email().max(320)).max(10).default([]),
  subject: z.string().trim().min(1).max(300).refine((value) => !/[\r\n]/.test(value)),
  body_text: z.string().trim().min(1).max(20000),
  attachment_ids: z.array(z.uuid()).max(10).default([]),
  related_action_id: z.uuid().nullable().default(null),
  idempotency_key: z.uuid(),
  override_reason: z.string().trim().min(3).max(500).optional(),
  scheduled_at: z.iso.datetime().optional(),
  policy_check_id: z.uuid().nullable().optional(),
});

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function ownedCase(caseId: string, write = false) {
  const access = await requireTenantPermission(write ? "communication.manage" : "case.read");
  if ("error" in access) return access;
  const { data, error } = await access.service.from("cases").select("*")
    .eq("id", caseId).eq("business_id", access.businessId).maybeSingle();
  if (error) return { error: "Unable to load case.", status: 503 } as const;
  if (!data) return { error: "Case not found.", status: 404 } as const;
  return { ...access, caseData: data as CaseRow };
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const access = await ownedCase(caseId);
  if ("error" in access) return response({ error: access.error }, access.status);
  if (!("caseData" in access)) return response({ error: "Case not found." }, 404);
  try {
    const [configuration, evidenceResult, contexts] = await Promise.all([
      listEmailConfiguration(access.service, access.businessId, access.user.id),
      access.service.from("evidence_files").select("id,file_name,file_size_bytes,file_type")
        .eq("case_id", caseId).eq("is_internal", false).is("archived_at", null).order("uploaded_at", { ascending: false }),
      loadContactGuardContexts(access.client, [caseId]),
    ]);
    if (evidenceResult.error || contexts.error) throw new Error(evidenceResult.error?.message ?? contexts.error ?? "Unable to load email composer.");
    const context = contexts.contexts.get(caseId);
    if (!context) throw new Error("Contact guard context is unavailable.");
    const identity = configuration.identity;
    const region = resolveRegionSettings(access.business);
    const currency = access.caseData.currency ?? region.defaultCurrency;
    const variables = {
      customer_name: access.caseData.debtor_name,
      invoice_number: access.caseData.invoice_no ?? access.caseData.id,
      due_date: formatCalendarDate(access.caseData.due_date, region),
      outstanding_amount: formatMinorCurrency(access.caseData.outstanding_minor, region, currency),
      payment_link: "Contact us for secure payment options.",
      business_signature: identity?.signature_text || access.business.legal_name || access.business.business_name,
    };
    return response({
      identity,
      sender_ready: identity?.verification_status === "verified" && Boolean(identity.verified_at),
      templates: configuration.templates.filter((template) => template.is_active).map((template) => ({
        ...template,
        rendered_subject: renderEmailTemplate(template.subject_template, variables),
        rendered_body: renderEmailTemplate(template.body_template, variables),
      })),
      attachments: (evidenceResult.data ?? []) as Pick<EvidenceFileRow, "id" | "file_name" | "file_size_bytes" | "file_type">[],
      default_to: access.caseData.debtor_email,
      guardrail: evaluateContactGuard(context, "email"),
    });
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Unable to load email composer." }, 503);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const access = await ownedCase(caseId, true);
  if ("error" in access) return response({ error: access.error }, access.status);
  if (!("caseData" in access)) return response({ error: "Case not found." }, 404);
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return response({ error: "Enter valid email details." }, 400);
  const data = parsed.data;
  const normalize = (values: string[]) => [...new Set(values.map((value) => value.toLowerCase()))];
  const to = normalize(data.to); const cc = normalize(data.cc); const bcc = normalize(data.bcc);
  if (new Set([...to, ...cc, ...bcc]).size !== to.length + cc.length + bcc.length) {
    return response({ error: "An address can appear in only one recipient field." }, 400);
  }
  if (data.action === "schedule") {
    if (!data.scheduled_at || new Date(data.scheduled_at).getTime() <= Date.now() + 60000) {
      return response({ error: "Choose a schedule time at least one minute in the future." }, 400);
    }
    const contexts = await loadContactGuardContexts(access.client, [caseId]);
    const context = contexts.contexts.get(caseId);
    if (contexts.error || !context) return response({ error: contexts.error ?? "Contact guard unavailable." }, 503);
    const guardrail = evaluateContactGuard(context, "email");
    const blocked = emailBlockedReason(context.preferences);
    if (blocked) return response({ error: blocked }, 409);
    if (!access.caseData.debtor_email || !to.includes(access.caseData.debtor_email.toLowerCase())) {
      return response({ error: "The customer email address must remain in the To field." }, 422);
    }
    if (guardrail.requires_override && !data.override_reason) {
      return response({ error: "A short reason is required to schedule after this contact warning.", guardrail }, 409);
    }
    const { identity } = await listEmailConfiguration(access.service, access.businessId, access.user.id);
    if (!identity || identity.verification_status !== "verified" || !identity.verified_at) {
      return response({ error: "Configure and verify an approved sender identity before scheduling email." }, 409);
    }
    let compliance;
    try {
      const scheduledFor = new Date(data.scheduled_at);
      compliance = await requireExecutableComplianceCheck(access.service, {
        businessId: access.businessId,
        caseId,
        actorId: access.user.id,
        jurisdiction: typeof access.business.country_code === "string" ? access.business.country_code : "MY",
        actionKind: "communication",
        channel: "email",
        subject: data.subject,
        bodyText: data.body_text,
        recipients: [...to, ...cc, ...bcc],
        evaluateAt: scheduledFor,
        expiresAt: new Date(scheduledFor.getTime() + 60 * 60 * 1000),
      }, data.policy_check_id);
    } catch (error) {
      if (error instanceof ComplianceGateError) return response(evaluationResponse(error), error.status);
      throw error;
    }
    const { data: scheduled, error } = await access.service.from("scheduled_email_followups").insert({
      business_id: access.businessId,
      case_id: caseId,
      customer_id: access.caseData.debtor_id,
      related_action_id: data.related_action_id,
      idempotency_key: data.idempotency_key,
      due_at: data.scheduled_at,
      timezone: resolveRegionSettings(access.business).timezone,
      to_recipients: to,
      cc_recipients: cc,
      bcc_recipients: bcc,
      subject: data.subject,
      body_text: data.body_text,
      attachment_ids: data.attachment_ids,
      override_reason: data.override_reason ?? null,
      status: "pending",
      created_by: access.user.id,
      policy_check_id: compliance.check.id,
      policy_content_hash: compliance.contentHash,
    }).select("*").single();
    if (error || !scheduled) {
      const { data: existing } = await access.service.from("scheduled_email_followups").select("*")
        .eq("business_id", access.businessId).eq("idempotency_key", data.idempotency_key).maybeSingle();
      if (existing) return response({ scheduled: existing, duplicate: true });
      return response({ error: "Unable to schedule email follow-up." }, 503);
    }
    return response({ scheduled }, 201);
  }
  try {
    const activity = await sendCaseEmail(access.service, {
      businessId: access.businessId,
      caseId,
      actorId: access.user.id,
      to, cc, bcc,
      subject: data.subject,
      bodyText: data.body_text,
      attachmentIds: data.attachment_ids,
      relatedActionId: data.related_action_id,
      idempotencyKey: data.idempotency_key,
      overrideReason: data.override_reason,
      policyCheckId: data.policy_check_id,
    });
    return response({ activity }, 201);
  } catch (error) {
    if (error instanceof ComplianceGateError) return response(evaluationResponse(error), error.status);
    const status = error instanceof CaseEmailError ? error.status : 503;
    return response({ error: error instanceof Error ? error.message : "Email delivery failed." }, status);
  }
}
