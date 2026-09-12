import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/client";
import type { Json } from "@/lib/supabase/types";
import { databaseAmountToMinor } from "@/lib/financial/money";
import {
  buildCaseTimeline,
  type CaseTimelineEvent,
  type TimelineAudience,
  type TimelineSourceEvent,
} from "./model";

type Row = Record<string, unknown>;

const text = (value: unknown) => value == null ? "" : String(value);
const nullableText = (value: unknown) => value == null ? null : String(value);
const json = (value: unknown): Json =>
  value && typeof value === "object" ? value as Json : {};
const words = (value: unknown) => text(value).replaceAll("_", " ");
const title = (value: unknown) => words(value).replace(/\b\w/g, (letter) => letter.toUpperCase());

function event(input: TimelineSourceEvent): TimelineSourceEvent {
  return input;
}

async function rows(query: PromiseLike<{ data: unknown; error: { message?: string } | null }>, label: string) {
  const result = await query;
  if (result.error) throw new Error(`Unable to load ${label}.`);
  return (result.data ?? []) as Row[];
}

/**
 * Loads existing source records and projects them into one event layer.
 * No source row is copied into another database table.
 */
export async function loadCaseTimeline(
  client: AppSupabaseClient,
  caseId: string,
  businessId: string,
  audience: TimelineAudience,
): Promise<CaseTimelineEvent[]> {
  const { data: caseData, error: caseError } = await client.from("cases")
    .select("id,business_id,invoice_no,due_date,status,created_at,closed_at,closed_by,closure_reason_code,contractual_due_minor")
    .eq("id", caseId).eq("business_id", businessId).maybeSingle();
  if (caseError) throw new Error("Unable to load case timeline.");
  if (!caseData) throw new Error("Case not found.");
  const currentCase = caseData as Row;

  const linkedObligations = await rows(client.from("recovery_case_obligations")
    .select("obligation_id").eq("business_id", businessId).eq("case_id", caseId), "linked receivables");
  const obligationIds = linkedObligations.map((row) => text(row.obligation_id)).filter(Boolean);
  const emptyRows = Promise.resolve({ data: [], error: null });

  const [
    statuses, reminders, communications, promises, disputes, negotiations,
    plans, planEvents, proofEvents, financialEvents, evidence, documents,
    handoffs, audit, pocketPayments, pocketReminderEvents, pocketReceiptLinks, pocketInvoices,
  ] = await Promise.all([
    rows(client.from("case_status_history").select("*").eq("case_id", caseId), "case changes"),
    rows(client.from("reminders").select("*").eq("case_id", caseId), "reminders"),
    rows(client.from("communication_activities").select("*").eq("business_id", businessId).eq("case_id", caseId), "communications"),
    rows(client.from("payment_promise_events").select("*").eq("business_id", businessId).eq("case_id", caseId), "promises"),
    rows(client.from("dispute_events").select("*").eq("business_id", businessId).eq("case_id", caseId), "disputes"),
    rows(client.from("payment_negotiation_events").select("*").eq("business_id", businessId).eq("case_id", caseId), "negotiations"),
    rows(client.from("payment_plans").select("*").eq("case_id", caseId), "payment plans"),
    rows(client.from("payment_plan_events").select("*").eq("business_id", businessId).eq("case_id", caseId), "payment plan events"),
    rows(client.from("payment_proof_events").select("*").eq("business_id", businessId).eq("case_id", caseId), "payment proof events"),
    rows(client.from("case_financial_events").select("*").eq("case_id", caseId), "financial events"),
    rows(client.from("evidence_files").select("*").eq("case_id", caseId), "evidence"),
    rows(client.from("legal_documents").select("*").eq("case_id", caseId), "documents"),
    rows(client.from("lawyer_referral_events").select("*").eq("business_id", businessId).eq("case_id", caseId), "handoff events"),
    rows(client.from("audit_logs").select("*").eq("business_id", businessId).eq("case_id", caseId), "audit events"),
    rows(obligationIds.length ? client.from("payment_allocations").select("*").eq("business_id", businessId)
      .in("obligation_id", obligationIds).is("case_id", null) : emptyRows, "Pocket payment history"),
    rows(obligationIds.length ? client.from("pocket_reminder_events").select("*").eq("business_id", businessId)
      .in("obligation_id", obligationIds) : emptyRows, "Pocket reminder history"),
    rows(obligationIds.length ? client.from("pocket_receipt_payment_links").select("*").eq("business_id", businessId)
      .in("debt_id", obligationIds) : emptyRows, "Pocket receipt history"),
    rows(obligationIds.length ? client.from("pocket_simple_invoices").select("*").eq("business_id", businessId)
      .in("obligation_id", obligationIds) : emptyRows, "Pocket invoice history"),
  ]);

  const sourceEvents: TimelineSourceEvent[] = [
    event({
      sourceTable: "cases", sourceId: caseId, type: "case.created",
      category: "case_changes", occurredAt: text(currentCase.created_at),
      actorType: "owner", summary: "Case created",
      amountMinor: nullableText(currentCase.contractual_due_minor),
      metadata: { invoice_no: nullableText(currentCase.invoice_no) },
      visibility: "customer_visible",
    }),
  ];
  const reminderCommunicationIds = new Set(communications.flatMap((row) => {
    const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown> : null;
    return metadata?.source === "reminder" && metadata.reminder_id ? [String(metadata.reminder_id)] : [];
  }));

  const dueAt = new Date(`${text(currentCase.due_date)}T00:00:00.000Z`);
  if (Number.isFinite(dueAt.getTime()) && dueAt.getTime() < Date.now()) {
    sourceEvents.push(event({
      sourceTable: "cases", sourceId: caseId, type: "invoice.overdue",
      category: "case_changes", occurredAt: dueAt.toISOString(),
      actorType: "system", summary: "Invoice became overdue",
      metadata: { invoice_no: nullableText(currentCase.invoice_no), due_date: text(currentCase.due_date) },
      visibility: "customer_visible",
    }));
  }
  if (currentCase.closed_at) {
    sourceEvents.push(event({
      sourceTable: "cases", sourceId: caseId, type: "case.closed",
      category: "case_changes", occurredAt: text(currentCase.closed_at),
      actorType: "owner", actorId: nullableText(currentCase.closed_by),
      summary: "Case closed",
      metadata: { reason_code: nullableText(currentCase.closure_reason_code) },
      visibility: "customer_visible",
    }));
  }

  for (const row of statuses) sourceEvents.push(event({
    sourceTable: "case_status_history", sourceId: text(row.id), type: "case.status_changed",
    category: "case_changes", occurredAt: text(row.created_at),
    actorType: nullableText(row.actor_type), actorId: nullableText(row.actor_id),
    summary: `Case status changed to ${words(row.to_status)}`,
    metadata: {
      from_status: nullableText(row.from_status),
      to_status: text(row.to_status),
      internal_reason: nullableText(row.transition_reason),
    },
    visibility: "internal_only",
  }));
  for (const row of reminders) {
    if (reminderCommunicationIds.has(text(row.id))) continue;
    sourceEvents.push(event({
    sourceTable: "reminders", sourceId: text(row.id), type: "reminder.generated",
    category: "communication", occurredAt: text(row.manually_confirmed_at ?? row.sent_at ?? row.generated_at),
    actorType: "owner", channel: nullableText(row.sent_channel),
    summary: `${title(row.message_type)} reminder ${row.manually_confirmed_at ? "sent" : words(row.status)}`,
    metadata: { status: text(row.status), template_version: Number(row.template_version ?? 1) },
    visibility: row.manually_confirmed_at || ["sent", "sent_manually"].includes(text(row.status))
      ? "customer_visible" : "internal_only",
    }));
  }
  for (const row of communications) sourceEvents.push(event({
    sourceTable: "communication_activities", sourceId: text(row.id),
    type: `communication.${text(row.status)}`, category: "communication",
    occurredAt: text(row.completed_at ?? row.started_at),
    actorType: row.direction === "inbound" ? "customer" : "staff",
    actorId: nullableText(row.staff_user_id), channel: nullableText(row.channel),
    summary: row.channel === "email" && row.direction === "inbound" && row.review_required
      ? `Email reply received — review required: ${text(row.subject) || "No subject"}`
      : row.channel === "email" && row.subject
      ? `Email ${words(row.direction)} (${words(row.status)}): ${text(row.subject)}`
      : `${title(row.channel)} ${words(row.direction)} communication`,
    metadata: audience === "staff"
      ? {
        direction: text(row.direction), status: text(row.status), outcome: nullableText(row.outcome),
        subject: nullableText(row.subject), sent_at: nullableText(row.sent_at),
        delivered_at: nullableText(row.delivered_at), opened_at: nullableText(row.opened_at),
        replied_at: nullableText(row.replied_at), failure_reason: nullableText(row.failure_reason),
        review_required: Boolean(row.review_required),
      }
      : { direction: text(row.direction), status: text(row.status) },
    visibility: "customer_visible",
  }));
  for (const row of promises) sourceEvents.push(event({
    sourceTable: "payment_promise_events", sourceId: text(row.id),
    type: `promise.${text(row.event_type)}`, category: "promises",
    occurredAt: text(row.created_at), actorType: nullableText(row.actor_type),
    actorId: nullableText(row.actor_id), summary: `Promise to Pay ${words(row.event_type)}`,
    amountMinor: nullableText(row.amount_minor),
    metadata: audience === "staff" ? { note: nullableText(row.note) } : {},
    visibility: "customer_visible",
  }));
  for (const row of disputes) sourceEvents.push(event({
    sourceTable: "dispute_events", sourceId: text(row.id),
    type: `dispute.${text(row.event_type)}`, category: "case_changes",
    occurredAt: text(row.created_at), actorType: nullableText(row.actor_type),
    actorId: nullableText(row.actor_id), summary: `Dispute ${words(row.event_type)}`,
    metadata: audience === "staff"
      ? { from_status: nullableText(row.from_status), to_status: text(row.to_status), response: nullableText(row.response) }
      : { to_status: text(row.to_status) },
    visibility: "customer_visible",
  }));
  for (const row of negotiations) sourceEvents.push(event({
    sourceTable: "payment_negotiation_events", sourceId: text(row.id),
    type: `negotiation.${text(row.event_type)}`, category: "promises",
    occurredAt: text(row.created_at), actorType: nullableText(row.actor_type),
    actorId: nullableText(row.actor_id), summary: `Payment negotiation ${words(row.event_type)}`,
    metadata: audience === "staff"
      ? { revision_no: row.revision_no == null ? null : Number(row.revision_no), note: nullableText(row.note) }
      : { revision_no: row.revision_no == null ? null : Number(row.revision_no) },
    visibility: "customer_visible",
  }));
  for (const row of plans) sourceEvents.push(event({
    sourceTable: "payment_plans", sourceId: text(row.id), type: "payment_plan.created",
    category: "promises", occurredAt: text(row.created_at), actorType: "owner",
    summary: "Payment plan proposed",
    amountMinor: databaseAmountToMinor(row.total_amount as string | number, text(row.currency)).toString(),
    metadata: { status: text(row.status), installment_count: Number(row.installment_count ?? 0), frequency: text(row.frequency) },
    visibility: "customer_visible",
  }));
  for (const row of planEvents) sourceEvents.push(event({
    sourceTable: "payment_plan_events", sourceId: text(row.id),
    type: `payment_plan.${text(row.event_type)}`, category: "promises",
    occurredAt: text(row.created_at), actorType: "system",
    summary: `Payment plan ${words(row.event_type)}`,
    amountMinor: nullableText(row.amount_minor),
    metadata: { event_date: text(row.event_date), paid_minor: nullableText(row.paid_minor) },
    visibility: "customer_visible",
  }));
  for (const row of proofEvents) sourceEvents.push(event({
    sourceTable: "payment_proof_events", sourceId: text(row.id),
    type: `payment_proof.${text(row.to_status)}`, category: "payments",
    occurredAt: text(row.created_at), actorType: nullableText(row.actor_type),
    actorId: nullableText(row.actor_id), channel: "portal",
    summary: `Payment Proof ${words(row.to_status)}`,
    metadata: audience === "staff"
      ? { from_status: nullableText(row.from_status), to_status: text(row.to_status), reason: nullableText(row.reason) }
      : { to_status: text(row.to_status) },
    visibility: "customer_visible",
  }));
  for (const row of financialEvents) sourceEvents.push(event({
    sourceTable: "case_financial_events", sourceId: text(row.id),
    type: `financial.${text(row.event_type)}`, category: "payments",
    occurredAt: text(row.created_at), actorType: row.created_by ? "owner" : "system",
    actorId: nullableText(row.created_by),
    summary: title(row.event_type), amountMinor: nullableText(row.amount_minor),
    metadata: { source_table: text(row.source_table), source_id: text(row.source_id) },
    visibility: "customer_visible",
  }));
  for (const row of pocketPayments) sourceEvents.push(event({
    sourceTable: "payment_allocations", sourceId: text(row.id),
    type: row.event_type === "reversal" ? "pocket.payment_reversed" : "pocket.payment_recorded",
    category: "payments", occurredAt: text(row.created_at),
    actorType: "owner", actorId: nullableText(row.created_by),
    summary: row.event_type === "reversal" ? "Pocket payment reversed" : "Pocket payment recorded",
    amountMinor: nullableText(row.target_amount_minor),
    metadata: audience === "staff" ? {
      obligation_id: nullableText(row.obligation_id), receipt_id: nullableText(row.receipt_id),
      currency: text(row.target_currency), reason: nullableText(row.reason),
    } : { currency: text(row.target_currency) },
    visibility: "customer_visible",
  }));
  for (const row of pocketReminderEvents) sourceEvents.push(event({
    sourceTable: "pocket_reminder_events", sourceId: text(row.id),
    type: `pocket.reminder_${text(row.event_type)}`, category: "communication",
    occurredAt: text(row.created_at), actorType: "owner", actorId: nullableText(row.created_by),
    channel: row.event_type === "opened_to_whatsapp" ? "whatsapp" : null,
    summary: row.event_type === "opened_to_whatsapp" ? "Pocket reminder opened in WhatsApp" : "Pocket reminder prepared",
    metadata: { template_key: text(row.template_key), language: text(row.language), user_edited: Boolean(row.user_edited) },
    visibility: row.event_type === "opened_to_whatsapp" ? "customer_visible" : "internal_only",
  }));
  for (const row of pocketReceiptLinks) sourceEvents.push(event({
    sourceTable: "pocket_receipt_payment_links", sourceId: text(row.id), type: "pocket.receipt_confirmed",
    category: "documents", occurredAt: text(row.created_at), actorType: "owner", actorId: nullableText(row.created_by),
    summary: "Pocket receipt confirmed and linked to payment",
    metadata: audience === "staff" ? { intake_id: text(row.intake_id), evidence_id: text(row.evidence_id), receipt_id: text(row.receipt_id) } : {},
    visibility: "internal_only",
  }));
  for (const row of pocketInvoices) sourceEvents.push(event({
    sourceTable: "pocket_simple_invoices", sourceId: text(row.id),
    type: `pocket.invoice_${text(row.status)}`, category: "documents",
    occurredAt: text(row.cancelled_at ?? row.issued_at ?? row.created_at), actorType: "owner", actorId: nullableText(row.updated_by),
    summary: `Pocket invoice ${text(row.invoice_number) || "draft"} ${words(row.status)}`,
    amountMinor: nullableText(row.total_minor),
    metadata: { invoice_number: nullableText(row.invoice_number), status: text(row.status), currency: text(row.currency) },
    visibility: row.status === "draft" ? "internal_only" : "customer_visible",
  }));
  for (const row of evidence) sourceEvents.push(event({
    sourceTable: "evidence_files", sourceId: text(row.id), type: "document.uploaded",
    category: "documents", occurredAt: text(row.uploaded_at), actorType: "owner",
    summary: `Evidence uploaded: ${text(row.file_name)}`,
    metadata: { evidence_type: text(row.evidence_type) },
    visibility: row.is_internal === false ? "customer_visible" : "internal_only",
  }));
  for (const row of documents) sourceEvents.push(event({
    sourceTable: "legal_documents", sourceId: text(row.id),
    type: row.sent_at ? "document.sent" : row.issued_at ? "document.issued" : "document.created",
    category: "documents", occurredAt: text(row.sent_at ?? row.issued_at ?? row.created_at),
    actorType: "owner", actorId: nullableText(row.issued_by),
    summary: `${text(row.title)} ${row.sent_at ? "sent" : row.issued_at ? "issued" : "created"}`,
    metadata: { document_type: text(row.document_type), status: text(row.status), document_number: nullableText(row.document_number) },
    visibility: row.sent_at || row.issued_at ? "customer_visible" : "internal_only",
  }));
  for (const row of handoffs) sourceEvents.push(event({
    sourceTable: "lawyer_referral_events", sourceId: text(row.id),
    type: `handoff.${text(row.event_type)}`, category: "documents",
    occurredAt: text(row.created_at), actorType: nullableText(row.actor_type),
    actorId: nullableText(row.actor_id), summary: `Professional handoff ${words(row.event_type)}`,
    metadata: audience === "staff" ? json(row.metadata) : {},
    visibility: "internal_only",
  }));
  for (const row of audit) {
    const action = text(row.action);
    if (action !== "statement.generated") continue;
    sourceEvents.push(event({
      sourceTable: "audit_logs", sourceId: text(row.id), type: action,
      category: "documents", occurredAt: text(row.created_at),
      actorType: nullableText(row.actor_type), actorId: nullableText(row.actor_id),
      summary: "Statement generated", metadata: {},
      visibility: "internal_only",
    }));
  }

  return buildCaseTimeline(sourceEvents, audience);
}
