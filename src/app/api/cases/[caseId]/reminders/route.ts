import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import { generateReminderMessage, type ReminderType } from "@/lib/reminders/generator";
import { getServiceClient } from "@/lib/supabase/service-client";
import type { CaseRow, ReceivingAccountRow, ReminderRow } from "@/lib/supabase/types";
import type { AppSupabaseClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

const reminderTypes = ["friendly", "formal", "final", "promise_followup", "payment_plan"] as const;
const channels = ["whatsapp", "email"] as const;
const requestKey = z.string().uuid();
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("generate"), messageType: z.enum(reminderTypes), channel: z.enum(channels), requestKey }),
  z.object({ action: z.literal("handoff"), reminderId: z.string().uuid(), handoff: z.enum(["copy", "whatsapp", "email"]) }),
  z.object({ action: z.literal("confirm_sent"), reminderId: z.string().uuid(), nextActionAt: z.string().datetime().optional() }),
]);

function invalidCaseId(caseId: string) {
  return !caseId || caseId.length > 100;
}

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function eligible(caseData: CaseRow): boolean {
  return caseData.status !== "paid" && caseData.status !== "closed" && !caseData.archived_at && Number(caseData.outstanding_minor) > 0;
}

function recipientFor(caseData: CaseRow, channel: "whatsapp" | "email") {
  const value = channel === "email" ? caseData.debtor_email : caseData.debtor_phone;
  return value?.trim() || null;
}

type OwnedCaseResult =
  | { client: AppSupabaseClient; businessId: string; caseData: CaseRow }
  | { error: string; notFound: boolean };

async function ownedCase(caseId: string): Promise<OwnedCaseResult> {
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) return { error: auth.error ?? "Reminder service is unavailable.", notFound: false };
  const { data, error } = await auth.client.from("cases").select("*").eq("id", caseId).eq("business_id", auth.businessId).maybeSingle();
  if (error || !data) return { error: "Case not found.", notFound: true };
  return { ...auth, caseData: data as CaseRow };
}

async function appendCommunicationAudit(businessId: string, caseId: string, action: string, metadata: Record<string, string | number | null>) {
  const service = await getServiceClient();
  if (!service) return;
  await service.from("audit_logs").insert({ business_id: businessId, case_id: caseId, action, actor_type: "owner", metadata });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  if (invalidCaseId(caseId)) return response({ error: "Invalid case ID." }, 400);
  const found = await ownedCase(caseId);
  if ("error" in found) return response({ error: found.error }, found.notFound ? 404 : 401);
  const { data, error } = await found.client.from("reminders").select("*").eq("case_id", caseId).order("generated_at", { ascending: false });
  if (error) return response({ error: "Unable to load communication history." }, 500);
  return response({ reminders: (data ?? []) as ReminderRow[] });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  if (invalidCaseId(caseId)) return response({ error: "Invalid case ID." }, 400);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return response({ error: "Invalid reminder request." }, 400);
  const found = await ownedCase(caseId);
  if ("error" in found) return response({ error: found.error }, found.notFound ? 404 : 401);
  if (!eligible(found.caseData)) return response({ error: "Reminders are unavailable after payment, closure, or archival." }, 409);

  if (parsed.data.action === "generate") {
    const recipient = recipientFor(found.caseData, parsed.data.channel);
    if (!recipient) return response({ error: `This debtor has no ${parsed.data.channel === "email" ? "email address" : "phone number"}.` }, 422);
    if (parsed.data.channel === "email" && !z.string().email().safeParse(recipient).success) return response({ error: "The debtor email address is invalid." }, 422);
    if (parsed.data.messageType === "payment_plan") {
      const { data: plan } = await found.client.from("payment_plans").select("id").eq("case_id", caseId).eq("status", "active").maybeSingle();
      if (!plan) return response({ error: "An active payment plan is required for this reminder." }, 409);
    }
    const accountQuery = found.caseData.receiving_account_id
      ? found.client.from("receiving_accounts").select("*").eq("id", found.caseData.receiving_account_id).eq("business_id", found.businessId).maybeSingle()
      : found.client.from("receiving_accounts").select("*").eq("business_id", found.businessId).eq("is_primary", true).eq("include_in_reminders", true).maybeSingle();
    const [{ data: account }, { data: business }] = await Promise.all([
      accountQuery,
      found.client.from("businesses").select("business_name, legal_name").eq("id", found.businessId).maybeSingle(),
    ]);
    const message = generateReminderMessage({
      reminderType: parsed.data.messageType as ReminderType,
      caseData: found.caseData,
      account: (account as ReceivingAccountRow | null) ?? null,
      businessName: (business as { business_name?: string; legal_name?: string | null } | null)?.legal_name || (business as { business_name?: string } | null)?.business_name || "our company",
    });
    const timestamp = new Date().toISOString();
    const insert = {
      case_id: caseId, message_type: parsed.data.messageType, message_body: message, sent_channel: parsed.data.channel,
      status: "draft", recipient, template_version: 1, generated_at: timestamp, sent_at: timestamp,
      request_key: parsed.data.requestKey, error_message: null,
    };
    const { data, error } = await found.client.from("reminders").insert(insert).select("*").single();
    if (error?.code === "23505") {
      const { data: existing } = await found.client.from("reminders").select("*").eq("case_id", caseId).eq("request_key", parsed.data.requestKey).maybeSingle();
      if (existing) return response({ reminder: existing as ReminderRow, duplicate: true });
    }
    if (error || !data) return response({ error: "Unable to generate reminder." }, 500);
    await appendCommunicationAudit(found.businessId, caseId, "reminder.generated", { type: parsed.data.messageType, channel: parsed.data.channel, template_version: 1 });
    return response({ reminder: data as ReminderRow }, 201);
  }

  const { data: reminder, error: lookupError } = await found.client.from("reminders").select("*").eq("id", parsed.data.reminderId).eq("case_id", caseId).maybeSingle();
  if (lookupError || !reminder) return response({ error: "Reminder not found." }, 404);
  if (parsed.data.action === "handoff") {
    const update = parsed.data.handoff === "copy" ? { status: "copied" } : { composer_opened_at: new Date().toISOString() };
    const { data, error } = await found.client.from("reminders").update(update).eq("id", parsed.data.reminderId).select("*").single();
    if (error || !data) return response({ error: "Unable to record handoff." }, 500);
    await appendCommunicationAudit(found.businessId, caseId, "reminder.handoff_opened", { channel: parsed.data.handoff, reminder_id: parsed.data.reminderId });
    return response({ reminder: data as ReminderRow });
  }

  if ((reminder as ReminderRow).manually_confirmed_at) return response({ reminder: reminder as ReminderRow, duplicate: true });
  const nextActionAt = parsed.data.nextActionAt ? new Date(parsed.data.nextActionAt) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(nextActionAt.getTime()) || nextActionAt <= new Date() || nextActionAt.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1000) return response({ error: "Next action must be within the next year." }, 400);
  const { data, error } = await found.client.from("reminders").update({ status: "sent_manually", manually_confirmed_at: new Date().toISOString(), next_action_at: nextActionAt.toISOString() }).eq("id", parsed.data.reminderId).select("*").single();
  if (error || !data) return response({ error: "Unable to confirm manual sending." }, 500);
  await appendCommunicationAudit(found.businessId, caseId, "reminder.manual_send_confirmed", { reminder_id: parsed.data.reminderId, next_action_at: nextActionAt.toISOString() });
  return response({ reminder: data as ReminderRow });
}
