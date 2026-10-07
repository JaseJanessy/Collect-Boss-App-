import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import { planActionDenial } from "@/lib/billing/plan-enforcement";
import { buildEvidencePackManifest, sortEvidenceForPack, validateEvidencePackSelection } from "@/lib/evidence/pack";
import { generateEvidencePackPdf, type EvidencePackData } from "@/lib/pdf/evidence-pack-generator";
import type { CaseRow, EvidenceFileRow, EvidenceType, PaymentPlanRow, PaymentRow, ReminderRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z.object({
  evidenceIds: z.array(z.uuid()).max(50),
  generationKey: z.uuid(),
});

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function selectedEvidenceTypes(files: EvidenceFileRow[]) {
  return [...new Set(files.map((file) => file.evidence_type))].sort();
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const input = requestSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return json({ error: "Invalid evidence-pack request." }, 400);

  const auth = await getAuthenticatedBusiness("case.manage");
  if ("error" in auth) return json({ error: auth.error ?? "Evidence-pack service is unavailable." }, 401);

  const { data: caseData } = await auth.client
    .from("cases")
    .select("*")
    .eq("id", caseId)
    .eq("business_id", auth.businessId)
    .maybeSingle();
  if (!caseData) return json({ error: "Case not found." }, 404);

  const { data: existing } = await auth.client
    .from("legal_documents")
    .select("id")
    .eq("case_id", caseId)
    .eq("document_type", "evidence_pack")
    .eq("generation_key", input.data.generationKey)
    .maybeSingle();
  if (existing) return json({ error: "This evidence pack request has already been processed." }, 409);

  const planDenial = await planActionDenial(auth.client, auth.businessId, "export_evidence_pack");
  if (planDenial) return planDenial;

  const evidenceQuery = input.data.evidenceIds.length === 0
    ? Promise.resolve({ data: [] as EvidenceFileRow[], error: null })
    : auth.client.from("evidence_files").select("*").eq("case_id", caseId).is("archived_at", null).in("id", input.data.evidenceIds);
  const [evidenceResult, businessResult, remindersResult, paymentsResult, plansResult] = await Promise.all([
    evidenceQuery,
    auth.client.from("businesses").select("business_name").eq("id", auth.businessId).maybeSingle(),
    auth.client.from("reminders").select("*").eq("case_id", caseId).order("sent_at", { ascending: true }),
    auth.client.from("payments").select("*").eq("case_id", caseId).order("created_at", { ascending: true }),
    auth.client.from("payment_plans").select("*").eq("case_id", caseId).in("status", ["pending_acceptance", "active", "defaulted"]).order("created_at", { ascending: false }).limit(1),
  ]);
  if (evidenceResult.error || businessResult.error || remindersResult.error || paymentsResult.error || plansResult.error) {
    return json({ error: "Unable to assemble the evidence pack." }, 500);
  }

  const selected = sortEvidenceForPack((evidenceResult.data ?? []) as EvidenceFileRow[]);
  if (selected.length !== input.data.evidenceIds.length) return json({ error: "One or more selected evidence files are unavailable or unauthorized." }, 409);
  const selectionError = validateEvidencePackSelection(selected);
  if (selectionError) return json({ error: selectionError }, 422);

  const generatedAt = new Date().toISOString();
  const manifest = buildEvidencePackManifest(caseId, selected, generatedAt);
  const selectedTypes = selectedEvidenceTypes(selected);
  const mandatoryTypes = ["invoice", "whatsapp", "payment_proof"];
  const missingMustHave = mandatoryTypes.filter((type) => !selectedTypes.includes(type as EvidenceType));
  const activePlan = ((plansResult.data ?? [])[0] ?? null) as PaymentPlanRow | null;
  const currentCase = caseData as CaseRow;
  const packData: EvidencePackData = {
    caseId,
    businessName: businessResult.data?.business_name ?? "CollectBoss business",
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
    status: currentCase.status,
    paymentLockMode: currentCase.payment_lock_mode,
    reminders: ((remindersResult.data ?? []) as ReminderRow[]).map((row) => ({ sent_at: row.sent_at, sent_channel: row.sent_channel, message_type: row.message_type, status: row.status })),
    payments: ((paymentsResult.data ?? []) as PaymentRow[]).map((row) => ({ created_at: row.created_at, amount: row.amount, payment_method: row.payment_method, reference_no: row.reference_no, review_status: row.review_status })),
    evidenceFiles: selected.map((file, index) => ({
      evidence_id: file.id,
      file_name: manifest.files[index].filename,
      file_type: file.file_type,
      evidence_type: file.evidence_type,
      file_size_bytes: file.file_size_bytes,
      uploaded_at: file.uploaded_at,
      content_sha256: file.content_sha256,
    })),
    uploadedEvidenceTypes: selectedTypes,
    missingMustHave,
    evidenceScore: Math.round((selectedTypes.length / 6) * 100),
    activePlan: activePlan ? { total_amount: activePlan.total_amount, installment_count: activePlan.installment_count, installment_amount: activePlan.installment_amount, due_dates: activePlan.due_dates, debtor_confirmed: activePlan.debtor_confirmed, confirmed_at: activePlan.confirmed_at } : null,
    timeline: [],
    hasAcknowledgement: Boolean(activePlan?.debtor_confirmed),
    generatedAt,
  };
  const title = `Evidence Pack - ${currentCase.debtor_name} - ${generatedAt.slice(0, 10)}`;
  const draftContent = JSON.stringify({ generated_at: generatedAt, generation_status: "generating", manifest });
  const { data: document, error: documentError } = await auth.client
    .from("legal_documents")
    .insert({ case_id: caseId, document_type: "evidence_pack", title, content: draftContent, status: "draft", generation_key: input.data.generationKey })
    .select("id")
    .single();
  if (documentError || !document) {
    return json({ error: "Unable to reserve this evidence-pack generation request." }, documentError?.code === "23505" ? 409 : 500);
  }

  try {
    const pdf = await generateEvidencePackPdf(packData);
    const content = JSON.stringify({ generated_at: generatedAt, generation_status: "complete", evidence_score: packData.evidenceScore, file_count: selected.length, reminder_count: packData.reminders.length, payment_count: packData.payments.length, manifest });
    const { error: updateError } = await auth.client.from("legal_documents").update({ content, status: "finalised" }).eq("id", document.id).eq("case_id", caseId);
    if (updateError) throw new Error("Unable to finalize the evidence-pack record.");
    const { error: auditError } = await auth.client.from("audit_logs").insert({ business_id: auth.businessId, case_id: caseId, action: "evidence_pack.generated", actor_type: "owner", metadata: { document_id: document.id, selected_evidence_count: selected.length, manifest_version: manifest.version } });
    if (auditError) throw new Error("Unable to record the evidence-pack audit event.");
    const filename = `evidence-pack-${caseId.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`;
    return new NextResponse(await pdf.arrayBuffer(), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=\"${filename}\"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    await auth.client.from("legal_documents").delete().eq("id", document.id).eq("case_id", caseId);
    return json({ error: error instanceof Error ? error.message : "Unable to generate the evidence pack." }, 500);
  }
}
