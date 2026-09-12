import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantPermission } from "@/lib/auth/tenant-access";
import { evaluateContactGuard } from "@/lib/communications/guardrails";
import { loadContactGuardContexts } from "@/lib/communications/guard-server";
import { CaseEmailError, sendCaseEmail } from "@/lib/email/service";
import { emailBlockedReason } from "@/lib/email/model";
import { generateReminderMessage } from "@/lib/reminders/generator";
import type { CaseRow, ReceivingAccountRow } from "@/lib/supabase/types";
import { ComplianceGateError } from "@/lib/compliance/service";

export const dynamic = "force-dynamic";

const schema = z.object({
  case_ids: z.array(z.string().min(1).max(100)).min(1).max(100),
  reminder_type: z.enum(["friendly", "formal", "final"]),
  override_reason: z.string().trim().min(3).max(500).optional(),
  confirmation: z.literal(true),
  policy_check_ids: z.record(z.string(), z.uuid()).optional(),
});

export async function POST(request: NextRequest) {
  const access = await requireTenantPermission("communication.manage");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Confirm a valid approved bulk reminder." }, { status: 400 });
  const caseIds = [...new Set(parsed.data.case_ids)];
  const [{ data: casesData }, { data: recoveryData }, { data: accountData }] = await Promise.all([
    access.service.from("cases").select("*").eq("business_id", access.businessId).in("id", caseIds),
    access.service.from("case_recovery_amounts").select("case_id,active_disputed_minor,collectable_minor")
      .eq("business_id", access.businessId).in("case_id", caseIds),
    access.service.from("receiving_accounts").select("*").eq("business_id", access.businessId)
      .eq("is_primary", true).eq("is_active", true).eq("include_in_reminders", true),
  ]);
  const cases = (casesData ?? []) as CaseRow[];
  if (cases.length !== caseIds.length) return NextResponse.json({ error: "One or more selected cases are unavailable." }, { status: 409 });
  const contexts = await loadContactGuardContexts(access.client, caseIds);
  if (contexts.error) return NextResponse.json({ error: contexts.error }, { status: 503 });
  const recovery = new Map((recoveryData ?? []).map((item) => [item.case_id, item]));
  const results: Array<{ case_id: string; status: "sent" | "excluded" | "failed" | "approval_required"; reason?: string; code?: string; policy_check_id?: string }> = [];
  const accountsByCurrency = new Map(
    ((accountData ?? []) as ReceivingAccountRow[]).map((account) => [account.currency, account]),
  );

  for (const caseData of cases) {
    const context = contexts.contexts.get(caseData.id)!;
    const blocked = emailBlockedReason(context.preferences);
    if (blocked) {
      results.push({ case_id: caseData.id, status: "excluded", reason: blocked });
      continue;
    }
    const evaluation = evaluateContactGuard(context, "email", {
      bulk: true, overrideProvided: Boolean(parsed.data.override_reason),
    });
    const amounts = recovery.get(caseData.id);
    const collectableMinor = Number(amounts?.collectable_minor ?? caseData.outstanding_minor);
    if (!evaluation.bulk_allowed) {
      results.push({ case_id: caseData.id, status: "excluded", reason: evaluation.warnings.join(" ") });
      continue;
    }
    if (!caseData.debtor_email || !z.email().safeParse(caseData.debtor_email).success) {
      results.push({ case_id: caseData.id, status: "excluded", reason: "No valid email address." });
      continue;
    }
    if (caseData.archived_at || ["paid", "closed"].includes(caseData.status) || collectableMinor <= 0) {
      results.push({ case_id: caseData.id, status: "excluded", reason: "Case is not eligible for reminders." });
      continue;
    }
    const message = generateReminderMessage({
      reminderType: parsed.data.reminder_type,
      caseData,
      account: accountsByCurrency.get(caseData.currency) ?? null,
      businessName: access.business.legal_name || access.business.business_name,
      collectableMinor,
      disputedPortion: Number(amounts?.active_disputed_minor ?? 0) > 0,
    });
    const requestKey = crypto.randomUUID();
    const { data: reminder, error: reminderError } = await access.service.from("reminders").insert({
      case_id: caseData.id, message_type: parsed.data.reminder_type, message_body: message,
      sent_channel: "email", status: "pending", recipient: caseData.debtor_email,
      request_key: requestKey, dispute_snapshot_minor: Number(amounts?.active_disputed_minor ?? 0),
      collectable_snapshot_minor: collectableMinor,
    }).select("id").single();
    if (reminderError || !reminder) {
      results.push({ case_id: caseData.id, status: "failed", reason: "Could not create delivery record." });
      continue;
    }
    const { error: attemptAuditError } = await access.service.from("audit_logs").insert({
      business_id: access.businessId, case_id: caseData.id, action: "reminder.bulk_email_delivery_started",
      actor_type: "staff", actor_id: access.user.id, actor_role: access.role,
      entity_type: "reminder", entity_id: reminder.id,
      metadata: { reminder_type: parsed.data.reminder_type, channel: "email" },
    });
    if (attemptAuditError) {
      await access.service.from("reminders").update({
        status: "failed", error_message: "Delivery blocked because the audit record could not be created.",
      }).eq("id", reminder.id).eq("case_id", caseData.id);
      results.push({ case_id: caseData.id, status: "failed", reason: "Delivery blocked because auditing is unavailable." });
      continue;
    }
    try {
      const activity = await sendCaseEmail(access.service, {
        businessId: access.businessId,
        caseId: caseData.id,
        actorId: access.user.id,
        to: [caseData.debtor_email.toLowerCase()],
        cc: [],
        bcc: [],
        subject: `Payment reminder · ${caseData.invoice_no ?? caseData.id}`,
        bodyText: message,
        attachmentIds: [],
        relatedActionId: null,
        idempotencyKey: requestKey,
        overrideReason: parsed.data.override_reason,
        policyCheckId: parsed.data.policy_check_ids?.[caseData.id],
        bulk: true,
      });
      await access.service.from("reminders").update({
        status: "sent", sent_at: new Date().toISOString(),
      }).eq("id", reminder.id).eq("case_id", caseData.id);
      if (evaluation.warnings.length && parsed.data.override_reason) {
        await access.service.from("contact_guard_overrides").update({ is_bulk: true } as never)
          .eq("communication_activity_id", activity.id).eq("business_id", access.businessId);
      }
      await access.service.from("audit_logs").insert({
        business_id: access.businessId, case_id: caseData.id, action: "reminder.bulk_email_sent",
        actor_type: "staff", actor_id: access.user.id, actor_role: access.role,
        entity_type: "reminder", entity_id: reminder.id,
        metadata: { reminder_type: parsed.data.reminder_type, provider: activity.provider },
      });
      results.push({ case_id: caseData.id, status: "sent" });
    } catch (error) {
      await access.service.from("reminders").update({
        status: "failed", error_message: error instanceof Error ? error.message.slice(0, 500) : "Delivery failed",
      }).eq("id", reminder.id).eq("case_id", caseData.id);
      if (error instanceof ComplianceGateError) {
        results.push({ case_id: caseData.id, status: error.code === "APPROVAL_REQUIRED" ? "approval_required" : "excluded", reason: error.message, code: error.code, policy_check_id: error.check?.id });
      } else {
        results.push({ case_id: caseData.id, status: "failed", reason: error instanceof CaseEmailError ? error.message : "Delivery failed." });
      }
    }
  }
  return NextResponse.json({
    results,
    sent: results.filter((item) => item.status === "sent").length,
    excluded: results.filter((item) => item.status === "excluded").length,
    failed: results.filter((item) => item.status === "failed").length,
    approval_required: results.filter((item) => item.status === "approval_required").length,
  }, { status: results.some((item) => item.status !== "sent") ? 207 : 200, headers: { "Cache-Control": "no-store" } });
}
