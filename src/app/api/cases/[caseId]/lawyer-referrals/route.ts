import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import { planActionDenial } from "@/lib/billing/plan-enforcement";
import { getServiceClient } from "@/lib/supabase/service-client";
import type { BusinessRow, CaseRow, EvidenceFileRow, Json, LegalDocumentRow, LawyerReferralEventRow, LawyerReferralRow, LegalHandoffDocumentRequestEvidenceRow, LegalHandoffDocumentRequestRow } from "@/lib/supabase/types";
import { canWithdrawReferral, isReferralEligible, LAWYER_REFERRAL_CONSENT_VERSION } from "@/lib/lawyer-referrals/controlled-handoff";
import { buildProfessionalHandoffPackage } from "@/lib/lawyer-referrals/package";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CONSENT_VERSION = LAWYER_REFERRAL_CONSENT_VERSION;
const createSchema = z.object({
  consentAccepted: z.literal(true),
  consentVersion: z.literal(CONSENT_VERSION),
  preferredContactMethod: z.enum(["whatsapp", "email", "phone"]),
  selectedEvidenceIds: z.array(z.string().uuid()).max(30),
  selectedFormalDemandId: z.string().uuid().nullable(),
  notes: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().uuid(),
});
const withdrawSchema = z.object({ action: z.literal("withdraw"), reason: z.string().trim().min(3).max(500) });

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const auth = await getAuthenticatedBusiness("case.read");
  if ("error" in auth) return json({ error: auth.error ?? "Professional legal handoff is unavailable." }, 401);
  const { data: ownedCase } = await auth.client.from("cases").select("id").eq("id", caseId).eq("business_id", auth.businessId).maybeSingle();
  if (!ownedCase) return json({ error: "Case not found." }, 404);
  const { data: referralData, error: referralError } = await auth.client.from("lawyer_referrals").select("*").eq("case_id", caseId).eq("business_id", auth.businessId).order("created_at", { ascending: false });
  if (referralError) return json({ error: "Unable to load professional legal handoffs." }, 500);
  const referrals = (referralData ?? []) as LawyerReferralRow[];
  const referralIds = referrals.map((item) => item.id);
  if (referralIds.length === 0) return json({ referrals: [] });
  const [eventResult, requestResult] = await Promise.all([
    auth.client.from("lawyer_referral_events").select("*").in("referral_id", referralIds).order("created_at", { ascending: true }),
    auth.client.from("legal_handoff_document_requests").select("*").in("referral_id", referralIds).order("created_at", { ascending: false }),
  ]);
  if (eventResult.error || requestResult.error) return json({ error: "Unable to load handoff activity." }, 500);
  const events = (eventResult.data ?? []) as LawyerReferralEventRow[];
  const requests = (requestResult.data ?? []) as LegalHandoffDocumentRequestRow[];
  const requestIds = requests.map((item) => item.id);
  const linkResult = requestIds.length
    ? await auth.client.from("legal_handoff_document_request_evidence").select("*").in("request_id", requestIds)
    : { data: [] as LegalHandoffDocumentRequestEvidenceRow[], error: null };
  if (linkResult.error) return json({ error: "Unable to load document responses." }, 500);
  const links = (linkResult.data ?? []) as LegalHandoffDocumentRequestEvidenceRow[];
  return json({ referrals: referrals.map((referral) => ({
    ...referral,
    events: events.filter((event) => event.referral_id === referral.id),
    documentRequests: requests.filter((request) => request.referral_id === referral.id).map((request) => ({
      ...request, evidenceIds: links.filter((link) => link.request_id === request.id).map((link) => link.evidence_id),
    })),
  })) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const input = createSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return json({ error: "Explicit data-sharing confirmation is required." }, 400);
  const auth = await getAuthenticatedBusiness("case.manage");
  if ("error" in auth) return json({ error: auth.error ?? "Referral service is unavailable." }, 401);
  const planDenial = await planActionDenial(auth.client, auth.businessId, "use_lawyer_referral");
  if (planDenial) return planDenial;
  const service = await getServiceClient();
  if (!service) return json({ error: "Referral service is unavailable." }, 503);

  const [{ data: caseData }, { data: business }, { data: userResult }] = await Promise.all([
    auth.client.from("cases").select("*").eq("id", caseId).eq("business_id", auth.businessId).maybeSingle(),
    auth.client.from("businesses").select("*").eq("id", auth.businessId).maybeSingle(),
    auth.client.auth.getUser(),
  ]);
  if (!caseData || !business || !userResult.user) return json({ error: "Case or creditor account not found." }, 404);
  const currentCase = caseData as CaseRow;
  const currentBusiness = business as BusinessRow;
  if (!isReferralEligible({ archivedAt: currentCase.archived_at, status: currentCase.status, balance: currentCase.balance })) return json({ error: "Only open cases with an outstanding balance can be referred." }, 422);
  if (!currentBusiness.legal_name?.trim() || !currentBusiness.contact_name?.trim() || !currentBusiness.email?.trim() || !currentBusiness.phone?.trim()) return json({ error: "Complete the creditor legal identity and contact details before requesting legal review." }, 422);

  const { data: replay } = await service.from("lawyer_referrals").select("*").eq("business_id", auth.businessId).eq("idempotency_key", input.data.idempotencyKey).maybeSingle();
  if (replay) return json({ referral: replay, replayed: true });
  const { data: openReferral } = await service.from("lawyer_referrals").select("id").eq("case_id", caseId).eq("business_id", auth.businessId).in("referral_status", ["ready_for_review", "handoff_pending", "handoff_failed", "submitted", "under_review", "additional_documents_requested", "lawyer_contacted", "accepted"]).maybeSingle();
  if (openReferral) return json({ error: "An active legal-review referral already exists for this case." }, 409);

  const { data: selectedEvidence, error: evidenceError } = await auth.client.from("evidence_files").select("*").eq("case_id", caseId).is("archived_at", null).in("id", input.data.selectedEvidenceIds);
  if (evidenceError || (selectedEvidence?.length ?? 0) !== input.data.selectedEvidenceIds.length) return json({ error: "One or more selected evidence records are unavailable." }, 422);
  let formalDemand: LegalDocumentRow | null = null;
  if (input.data.selectedFormalDemandId) {
    const { data: demand } = await auth.client.from("legal_documents").select("*").eq("id", input.data.selectedFormalDemandId).eq("case_id", caseId).in("document_type", ["demand_standard", "demand_firm", "demand_final"]).not("issued_at", "is", null).maybeSingle();
    if (!demand) return json({ error: "The selected formal demand is unavailable or has not been issued." }, 422);
    formalDemand = demand as LegalDocumentRow;
  }

  const [financialResult, historyResult, reminderResult, paymentResult, documentResult] = await Promise.all([
    auth.client.from("case_financial_events").select("id, event_type, amount_minor, created_at").eq("case_id", caseId).order("created_at"),
    auth.client.from("case_status_history").select("id, from_status, to_status, created_at").eq("case_id", caseId).order("created_at"),
    auth.client.from("reminders").select("id, message_type, sent_channel, status, sent_at, generated_at").eq("case_id", caseId).order("generated_at"),
    auth.client.from("payments").select("id, amount, payment_method, reference_no, reviewed_at, created_at").eq("case_id", caseId).eq("review_status", "approved").order("created_at"),
    auth.client.from("legal_documents").select("id, document_type, title, status, document_number, template_version, issued_at").eq("case_id", caseId).order("created_at"),
  ]);
  if (financialResult.error || historyResult.error || reminderResult.error || paymentResult.error || documentResult.error) return json({ error: "Unable to assemble the professional handoff package." }, 500);
  const evidenceRows = (selectedEvidence ?? []) as EvidenceFileRow[];
  const now = new Date().toISOString();
  const id = randomUUID();
  const documents = (documentResult.data ?? []) as Parameters<typeof buildProfessionalHandoffPackage>[0]["documents"];
  const dataPackage = buildProfessionalHandoffPackage({
    caseData: currentCase, business: currentBusiness, evidence: evidenceRows, documents,
    financialEvents: (financialResult.data ?? []) as Parameters<typeof buildProfessionalHandoffPackage>[0]["financialEvents"],
    statusHistory: historyResult.data ?? [], reminders: reminderResult.data ?? [], payments: paymentResult.data ?? [], createdAt: now,
  });
  const consentSnapshot: Json = { version: CONSENT_VERSION, accepted_at: now, statement: "I confirm that I am authorised to request external legal review and consent to the selected case data being prepared for a professional handoff. I understand that CollectBoss does not provide legal advice, no professional has accepted this matter, and no legal representation is created." };
  const summary = `${currentCase.debtor_name}: RM ${currentCase.balance.toFixed(2)} outstanding; due ${currentCase.due_date}.`;
  const { data: referral, error: referralError } = await service.from("lawyer_referrals").insert({ id, case_id: caseId, business_id: auth.businessId, referral_status: "ready_for_review", partner_id: null, partner_name: null, partner_firm: null, preferred_contact_method: input.data.preferredContactMethod, case_summary: summary, evidence_pack_id: null, formal_demand_id: formalDemand?.id ?? null, notes: input.data.notes || null, consent_version: CONSENT_VERSION, consented_at: now, consent_snapshot: consentSnapshot, data_package_snapshot: dataPackage, data_package_created_at: now, shared_at: null, handoff_channel: null, provider_reference: null, withdrawn_at: null, withdrawal_reason: null, idempotency_key: input.data.idempotencyKey, last_handoff_error: null, updated_at: now }).select("*").single();
  if (referralError || !referral) return json({ error: "Unable to create the legal-review referral." }, 500);
  const events = [
    { referral_id: id, case_id: caseId, business_id: auth.businessId, event_type: "created", actor_type: "owner", actor_id: userResult.user.id, metadata: { status: "ready_for_review", consent_version: CONSENT_VERSION } },
    { referral_id: id, case_id: caseId, business_id: auth.businessId, event_type: "data_package_created", actor_type: "owner", actor_id: userResult.user.id, metadata: { evidence_count: evidenceRows.length, formal_demand_id: formalDemand?.id ?? null, shared: false } },
  ];
  const { error: eventsError } = await service.from("lawyer_referral_events").insert(events);
  const { error: auditError } = await service.from("audit_logs").insert({ business_id: auth.businessId, case_id: caseId, action: "lawyer_referral.requested", actor_type: "owner", actor_id: userResult.user.id, metadata: { referral_id: id, consent_version: CONSENT_VERSION, evidence_count: evidenceRows.length, formal_demand_id: formalDemand?.id ?? null, shared: false } });
  if (eventsError || auditError) {
    await service.from("lawyer_referrals").delete().eq("id", id);
    return json({ error: "Unable to record the referral audit trail." }, 500);
  }
  return json({ referral, providerConfigured: false }, 201);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const input = withdrawSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return json({ error: "A withdrawal reason is required." }, 400);
  const auth = await getAuthenticatedBusiness("case.manage");
  if ("error" in auth) return json({ error: auth.error ?? "Referral service is unavailable." }, 401);
  const service = await getServiceClient();
  if (!service) return json({ error: "Referral service is unavailable." }, 503);
  const { data: { user } } = await auth.client.auth.getUser();
  const { data: referral } = await service.from("lawyer_referrals").select("*").eq("case_id", caseId).eq("business_id", auth.businessId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!referral) return json({ error: "No withdrawable referral was found for this case." }, 404);
  if (!canWithdrawReferral(referral.referral_status)) return json({ error: "This referral can no longer be withdrawn." }, 409);
  const now = new Date().toISOString();
  const { data: updated, error } = await service.from("lawyer_referrals").update({ referral_status: "withdrawn", withdrawn_at: now, withdrawal_reason: input.data.reason, updated_at: now }).eq("id", referral.id).select("*").single();
  if (error || !updated) return json({ error: "Unable to withdraw the referral." }, 500);
  await service.from("lawyer_referral_events").insert({ referral_id: referral.id, case_id: caseId, business_id: auth.businessId, event_type: "withdrawn", actor_type: "owner", actor_id: user?.id ?? null, metadata: { reason: input.data.reason } });
  await service.from("audit_logs").insert({ business_id: auth.businessId, case_id: caseId, action: "lawyer_referral.withdrawn", actor_type: "owner", actor_id: user?.id ?? null, metadata: { referral_id: referral.id, reason: input.data.reason } });
  return json({ referral: updated });
}
