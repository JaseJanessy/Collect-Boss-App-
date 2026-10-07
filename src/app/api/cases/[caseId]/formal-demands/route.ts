import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import { planActionDenial } from "@/lib/billing/plan-enforcement";
import { FORMAL_DEMAND_DISCLAIMER, FORMAL_DEMAND_TEMPLATE_VERSION, type FormalDemandSnapshot, type FormalDemandTone, buildFormalDemandText, toDemandPdfData } from "@/lib/formal-demands/template";
import { generateDemandPdf } from "@/lib/pdf/demand-generator";
import { getServiceClient } from "@/lib/supabase/service-client";
import type { BusinessRow, CaseRow, PaymentRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const inputSchema = z.object({
  mode: z.enum(["draft", "issue"]),
  tone: z.enum(["standard", "firm", "final"]),
  deadlineDays: z.union([z.literal(3), z.literal(7), z.literal(14)]),
  includePayment: z.boolean().default(false),
  includeEvidenceRef: z.boolean().default(false),
});

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function longDate(date: Date): string {
  return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

function dueDate(days: number): { iso: string; label: string } {
  const value = new Date();
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + days);
  return { iso: value.toISOString().slice(0, 10), label: longDate(value) };
}

function validateIdentities(business: BusinessRow, caseData: CaseRow): string | null {
  if (!business.account_type || !business.business_name.trim() || !business.legal_name?.trim() || !business.contact_name?.trim() || !business.phone?.trim() || !business.email?.trim()) return "Complete your business identity before creating a payment notice.";
  if (business.account_type === "business" && !business.registration_no?.trim()) return "A business creditor requires a registration number before issuing a payment notice.";
  if (!caseData.debtor_name.trim()) return "The debtor identity is incomplete.";
  if (caseData.debtor_type === "business" && !(caseData.debtor_company ?? caseData.debtor_name).trim()) return "The business debtor identity is incomplete.";
  if (caseData.balance <= 0) return "Payment notices can only be created for a positive outstanding balance.";
  if (!caseData.due_date) return "The debt due date is required before creating a payment notice.";
  return null;
}

function buildSnapshot(params: {
  caseData: CaseRow;
  business: BusinessRow;
  payments: PaymentRow[];
  reminderCount: number;
  tone: FormalDemandTone;
  deadlineDays: number;
  includePayment: boolean;
  paymentInstructions: FormalDemandSnapshot["paymentInstructions"];
  includeEvidenceRef: boolean;
  documentNumber: string | null;
  issuedAt: string | null;
}): FormalDemandSnapshot {
  const deadline = dueDate(params.deadlineDays);
  const generatedAt = new Date().toISOString();
  const debtReference = params.caseData.invoice_no ? `Invoice No. ${params.caseData.invoice_no}` : `Case Reference ${params.caseData.id}`;
  const creditor = {
    accountType: params.business.account_type!, legalName: params.business.legal_name!.trim(), contactName: params.business.contact_name!.trim(), registrationNo: params.business.registration_no,
    phone: params.business.phone!.trim(), email: params.business.email!.trim(), address: params.business.address,
  };
  const snapshot: FormalDemandSnapshot = {
    templateVersion: FORMAL_DEMAND_TEMPLATE_VERSION,
    documentNumber: params.documentNumber,
    generatedAt,
    issuedAt: params.issuedAt,
    tone: params.tone,
    deadlineDate: deadline.label,
    deadlineDays: params.deadlineDays,
    creditor,
    debtor: { type: params.caseData.debtor_type, name: params.caseData.debtor_name, company: params.caseData.debtor_company, registrationNo: params.caseData.debtor_reg_no, phone: params.caseData.debtor_phone, email: params.caseData.debtor_email, address: params.caseData.debtor_location },
    debtItems: [{ reference: debtReference, dueDate: params.caseData.due_date, originalAmount: params.caseData.amount_owed, paidAmount: params.caseData.amount_paid, outstandingAmount: params.caseData.balance }],
    approvedPayments: params.payments.map((payment) => ({ date: payment.created_at, amount: payment.amount, method: payment.payment_method, reference: payment.reference_no })),
    reminderCount: params.reminderCount,
    paymentInstructionsIncluded: params.includePayment,
    paymentInstructions: params.paymentInstructions,
    evidenceReferenceIncluded: params.includeEvidenceRef,
    legalReviewRequired: params.tone === "final",
    legalReviewReason: params.tone === "final" ? "Final-notice escalation language requires qualified external review before legal action." : null,
    disclaimer: FORMAL_DEMAND_DISCLAIMER,
    pdf: { caseId: params.caseData.id, businessName: creditor.legalName, tone: params.tone, deadlineDays: params.deadlineDays, deadlineDate: deadline.label, today: longDate(new Date()), draftText: "", documentNumber: params.documentNumber, templateVersion: FORMAL_DEMAND_TEMPLATE_VERSION },
  };
  snapshot.pdf.draftText = buildFormalDemandText(snapshot);
  return snapshot;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return json({ error: "Invalid formal-demand request." }, 400);
  const auth = await getAuthenticatedBusiness("case.manage");
  if ("error" in auth) return json({ error: auth.error ?? "Formal-demand service is unavailable." }, 401);
  const planDenial = await planActionDenial(auth.client, auth.businessId, "use_formal_demand");
  if (planDenial) return planDenial;
  const service = await getServiceClient();
  if (!service) return json({ error: "Formal-demand issuance service is unavailable." }, 503);
  const [{ data: caseData }, { data: business }, { data: userResult }, { data: reminders }, { data: payments }] = await Promise.all([
    auth.client.from("cases").select("*").eq("id", caseId).eq("business_id", auth.businessId).maybeSingle(),
    auth.client.from("businesses").select("*").eq("id", auth.businessId).maybeSingle(),
    auth.client.auth.getUser(),
    auth.client.from("reminders").select("id", { count: "exact" }).eq("case_id", caseId),
    auth.client.from("payments").select("*").eq("case_id", caseId).eq("review_status", "approved").order("created_at", { ascending: true }),
  ]);
  if (!caseData || !business || !userResult.user) return json({ error: "Case or creditor account not found." }, 404);
  const currentCase = caseData as CaseRow;
  const currentBusiness = business as BusinessRow;
  const identityError = validateIdentities(currentBusiness, currentCase);
  if (identityError) return json({ error: identityError }, 422);
  if (input.data.includePayment && !currentCase.receiving_account_id) return json({ error: "Select a receiving account before including payment instructions." }, 422);
  let paymentInstructions: FormalDemandSnapshot["paymentInstructions"] = null;
  if (input.data.includePayment) {
    const { data: account } = await auth.client.from("receiving_accounts").select("bank_name, account_holder_name, account_number, duitnow_id").eq("id", currentCase.receiving_account_id!).eq("business_id", auth.businessId).eq("currency", currentCase.currency).eq("is_active", true).not("verification_status", "in", "(rejected,disabled)").maybeSingle();
    if (!account) return json({ error: "The case receiving account is unavailable." }, 422);
    paymentInstructions = { bankName: account.bank_name, accountHolder: account.account_holder_name, accountNumber: account.account_number, duitnowId: account.duitnow_id };
  }

  const issuedAt = input.data.mode === "issue" ? new Date().toISOString() : null;
  const id = randomUUID();
  const number = issuedAt ? `CB-FD-${issuedAt.slice(0, 10).replace(/-/g, "")}-${id.slice(0, 8).toUpperCase()}` : null;
  const snapshot = buildSnapshot({ caseData: currentCase, business: currentBusiness, payments: (payments ?? []) as PaymentRow[], reminderCount: reminders?.length ?? 0, tone: input.data.tone, deadlineDays: input.data.deadlineDays, includePayment: input.data.includePayment, paymentInstructions, includeEvidenceRef: input.data.includeEvidenceRef, documentNumber: number, issuedAt });
  const productLabel = input.data.tone === "final" ? "Final Payment Notice" : input.data.tone === "firm" ? "Firm Payment Reminder" : "Formal Payment Reminder";
  const title = `${productLabel} - ${currentCase.debtor_name} - ${snapshot.pdf.today}`;
  let pdf: Blob | null = null;
  try {
    if (input.data.mode === "issue") pdf = await generateDemandPdf(toDemandPdfData(snapshot));
    const { data: document, error: documentError } = await service.from("legal_documents").insert({ id, case_id: caseId, document_type: `demand_${input.data.tone}`, title, content: JSON.stringify({ draft_text: snapshot.pdf.draftText, snapshot }), status: issuedAt ? "finalised" : "draft", document_number: number, template_version: FORMAL_DEMAND_TEMPLATE_VERSION, issued_at: issuedAt, issued_by: userResult.user.id, snapshot }).select("*").single();
    if (documentError || !document) throw new Error("Unable to persist the payment notice.");
    const { error: auditError } = await service.from("audit_logs").insert({ business_id: auth.businessId, case_id: caseId, action: issuedAt ? "formal_demand.issued" : "formal_demand.drafted", actor_type: "owner", actor_id: userResult.user.id, metadata: { document_id: id, document_number: number, template_version: FORMAL_DEMAND_TEMPLATE_VERSION, tone: input.data.tone, product_label: productLabel, legal_review_required: snapshot.legalReviewRequired } });
    if (auditError) {
      await service.from("legal_documents").delete().eq("id", id);
      throw new Error("Unable to record the formal-demand audit event.");
    }
    if (!pdf) return json({ document, snapshot });
    return new NextResponse(await pdf.arrayBuffer(), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename=\"payment-notice-${number}.pdf\"`, "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "X-Formal-Demand-Id": id } });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unable to create the payment notice." }, 500);
  }
}
