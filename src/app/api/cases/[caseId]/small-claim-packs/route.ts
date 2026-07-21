import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import { generateSmallClaimPdf, type SmallClaimCheckItem } from "@/lib/pdf/small-claim-generator";
import { getServiceClient } from "@/lib/supabase/service-client";
import type { BusinessRow, CaseRow, EvidenceFileRow, PaymentRow } from "@/lib/supabase/types";
import { SMALL_CLAIM_DISCLAIMER, SMALL_CLAIM_TEMPLATE_VERSION, type SmallClaimPackSnapshot } from "@/lib/small-claims/template";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const inputSchema = z.object({ mode: z.enum(["save", "issue"]) });

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function longDate(date: Date): string {
  return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

function validateRequiredFields(business: BusinessRow, caseData: CaseRow): string | null {
  if (!business.account_type || !business.legal_name?.trim() || !business.contact_name?.trim() || !business.phone?.trim() || !business.email?.trim() || !business.address?.trim()) return "Complete the creditor legal name, contact, phone, email, and address before creating a case-record pack.";
  if (business.account_type === "business" && !business.registration_no?.trim()) return "A business creditor requires a registration number before creating a case-record pack.";
  if (!caseData.debtor_name.trim() || !caseData.debtor_location?.trim()) return "The debtor name and address are required before creating a case-record pack.";
  if (caseData.debtor_type === "business" && (!caseData.debtor_company?.trim() || !caseData.debtor_reg_no?.trim())) return "A business debtor requires its business name and registration number before creating a case-record pack.";
  if (!caseData.due_date || caseData.balance <= 0) return "A positive outstanding balance and due date are required before creating a case-record pack.";
  return null;
}

function buildChecklist(params: { caseData: CaseRow; evidence: EvidenceFileRow[]; reminderCount: number; approvedPayments: PaymentRow[]; hasEvidencePack: boolean; hasFormalDemand: boolean; }) {
  const evidenceTypes = new Set(params.evidence.map((file) => file.evidence_type));
  const items: SmallClaimCheckItem[] = [
    { id: "balance", label: "Positive outstanding balance recorded", done: params.caseData.balance > 0 },
    { id: "debtor_identity", label: "Debtor name and address recorded", done: Boolean(params.caseData.debtor_name && params.caseData.debtor_location) },
    { id: "invoice", label: "Invoice or written amount proof uploaded", done: evidenceTypes.has("invoice") || evidenceTypes.has("contract") },
    { id: "communications", label: "Communication evidence uploaded", done: evidenceTypes.has("whatsapp") },
    { id: "due_date", label: "Payment due date recorded", done: Boolean(params.caseData.due_date) },
    { id: "reminders", label: "Reminder history recorded", done: params.reminderCount > 0 },
    { id: "payments", label: "Approved payment records reviewed", done: params.approvedPayments.length > 0 },
    { id: "evidence_pack", label: "Evidence pack available", done: params.hasEvidencePack },
    { id: "formal_demand", label: "Formal demand record available", done: params.hasFormalDemand },
  ];
  return items;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return json({ error: "Invalid case-record pack request." }, 400);

  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) return json({ error: auth.error ?? "Case-record pack service is unavailable." }, 401);
  const service = await getServiceClient();
  if (!service) return json({ error: "Case-record pack service is unavailable." }, 503);

  const [{ data: caseData }, { data: business }, { data: userResult }, { data: evidence, error: evidenceError }, { data: reminders, error: remindersError }, { data: payments, error: paymentsError }, { data: documents, error: documentsError }, { data: acknowledgements, error: acknowledgementsError }] = await Promise.all([
    auth.client.from("cases").select("*").eq("id", caseId).eq("business_id", auth.businessId).maybeSingle(),
    auth.client.from("businesses").select("*").eq("id", auth.businessId).maybeSingle(),
    auth.client.auth.getUser(),
    auth.client.from("evidence_files").select("*").eq("case_id", caseId).is("archived_at", null).order("uploaded_at", { ascending: true }),
    auth.client.from("reminders").select("id", { count: "exact" }).eq("case_id", caseId),
    auth.client.from("payments").select("*").eq("case_id", caseId).eq("review_status", "approved").order("created_at", { ascending: true }),
    auth.client.from("legal_documents").select("document_type").eq("case_id", caseId),
    auth.client.from("payment_plan_acknowledgements").select("decision, acknowledged_at, terms_version, payment_plans!inner(case_id)").eq("payment_plans.case_id", caseId).order("acknowledged_at", { ascending: false }).limit(1),
  ]);
  if (!caseData || !business || !userResult.user) return json({ error: "Case or creditor account not found." }, 404);
  if (evidenceError || remindersError || paymentsError || documentsError || acknowledgementsError) return json({ error: "Case-record source data is temporarily unavailable." }, 503);
  const currentCase = caseData as CaseRow;
  const currentBusiness = business as BusinessRow;
  const validationError = validateRequiredFields(currentBusiness, currentCase);
  if (validationError) return json({ error: validationError }, 422);

  const evidenceRows = (evidence ?? []) as EvidenceFileRow[];
  const approvedPayments = (payments ?? []) as PaymentRow[];
  const documentTypes = new Set((documents ?? []).map((document) => (document as { document_type: string }).document_type));
  const checklist = buildChecklist({ caseData: currentCase, evidence: evidenceRows, reminderCount: reminders?.length ?? 0, approvedPayments, hasEvidencePack: documentTypes.has("evidence_pack"), hasFormalDemand: ["demand_standard", "demand_firm", "demand_final"].some((type) => documentTypes.has(type)) });
  const missingItems = checklist.filter((item) => !item.done).map((item) => item.label);
  const acknowledgementRow = (acknowledgements?.[0] ?? null) as { decision: "accepted" | "rejected"; acknowledged_at: string; terms_version: number } | null;
  const timeline = [
    { date: currentCase.created_at, event: "Case record created" },
    ...evidenceRows.map((file) => ({ date: file.uploaded_at, event: `Evidence added: ${file.file_name}` })),
    ...approvedPayments.map((payment) => ({ date: payment.created_at, event: `Approved payment recorded: RM ${payment.amount.toFixed(2)}` })),
    ...(acknowledgementRow ? [{ date: acknowledgementRow.acknowledged_at, event: `Payment-plan response recorded: ${acknowledgementRow.decision}` }] : []),
  ].sort((left, right) => left.date.localeCompare(right.date));
  const issuedAt = new Date().toISOString();
  const snapshot: SmallClaimPackSnapshot = {
    templateVersion: SMALL_CLAIM_TEMPLATE_VERSION,
    generatedAt: issuedAt,
    issuedAt,
    jurisdiction: { code: "MY", label: "Malaysia", filingRulesVerifiedAt: null },
    legalReviewRequired: true,
    checklist,
    missingItems,
    acknowledgement: acknowledgementRow ? { decision: acknowledgementRow.decision, acknowledgedAt: acknowledgementRow.acknowledged_at, termsVersion: acknowledgementRow.terms_version } : null,
    pdf: {
      caseId: currentCase.id,
      businessName: currentBusiness.legal_name!.trim(),
      today: longDate(new Date()),
      debtorName: currentCase.debtor_name,
      debtorCompany: currentCase.debtor_company,
      debtorRegNo: currentCase.debtor_reg_no,
      debtorPhone: currentCase.debtor_phone,
      debtorEmail: currentCase.debtor_email,
      debtorLocation: currentCase.debtor_location,
      amountOwed: currentCase.amount_owed,
      amountPaid: currentCase.amount_paid,
      balance: currentCase.balance,
      dueDate: currentCase.due_date,
      invoiceNo: currentCase.invoice_no,
      daysOverdue: currentCase.days_overdue,
      checklist,
      readinessStatus: missingItems.length === 0 ? "ready" : missingItems.length <= 3 ? "almost_ready" : "not_ready",
      readinessPct: Math.round(((checklist.length - missingItems.length) / checklist.length) * 100),
      reminderCount: reminders?.length ?? 0,
      paymentCount: approvedPayments.length,
      hasEvidencePack: documentTypes.has("evidence_pack"),
      hasFormalDemand: ["demand_standard", "demand_firm", "demand_final"].some((type) => documentTypes.has(type)),
      hasPaymentPlan: Boolean(acknowledgementRow),
      hasAcknowledgement: acknowledgementRow?.decision === "accepted",
      timeline,
      evidenceFiles: evidenceRows.map((file) => ({ name: file.file_name, type: file.file_type })),
      missingItems,
      jurisdictionLabel: "Malaysia (filing rules require external verification)",
      disclaimer: SMALL_CLAIM_DISCLAIMER,
    },
  };
  const id = randomUUID();
  const number = `CB-CRP-${issuedAt.slice(0, 10).replace(/-/g, "")}-${id.slice(0, 8).toUpperCase()}`;
  try {
    const { data: document, error: documentError } = await service.from("legal_documents").insert({ id, case_id: caseId, document_type: "small_claim_pack", title: `Case-record pack - ${currentCase.debtor_name} - ${snapshot.pdf.today}`, content: JSON.stringify({ snapshot }), status: "finalised", document_number: number, template_version: SMALL_CLAIM_TEMPLATE_VERSION, issued_at: issuedAt, issued_by: userResult.user.id, snapshot }).select("*").single();
    if (documentError || !document) throw new Error("Unable to persist the case-record pack.");
    const { error: auditError } = await service.from("audit_logs").insert({ business_id: auth.businessId, case_id: caseId, action: "small_claim_pack.issued", actor_type: "owner", actor_id: userResult.user.id, metadata: { document_id: id, document_number: number, template_version: SMALL_CLAIM_TEMPLATE_VERSION, jurisdiction: "MY", legal_review_required: true } });
    if (auditError) {
      await service.from("legal_documents").delete().eq("id", id);
      throw new Error("Unable to record the case-record pack audit event.");
    }
    if (input.data.mode === "save") return json({ document, snapshot });
    const pdf = await generateSmallClaimPdf(snapshot.pdf);
    return new NextResponse(await pdf.arrayBuffer(), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename=\"case-record-pack-${number}.pdf\"`, "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "X-Small-Claim-Pack-Id": id } });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unable to create the case-record pack." }, 500);
  }
}
