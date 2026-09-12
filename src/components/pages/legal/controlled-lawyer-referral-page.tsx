"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, ChevronLeft, FileText, Send } from "lucide-react";
import { LoadingSpinner, InlineSpinner } from "@/components/ui/loading-spinner";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SectionCard } from "@/components/ui/section-card";
import { useCase } from "@/hooks/use-case";
import { useEvidence } from "@/hooks/use-evidence";
import { useLegalDocuments } from "@/hooks/use-legal-documents";
import { useLawyerReferrals } from "@/hooks/use-lawyer-referrals";
import type { ContactMethod, LawyerReferralRow } from "@/lib/supabase/types";
import type { ProfessionalLegalHandoff } from "@/lib/db/lawyer-referrals-client";
import { ACTIVE_REFERRAL_STATUSES, canWithdrawReferral, isReferralEligible, LAWYER_REFERRAL_CONSENT_VERSION } from "@/lib/lawyer-referrals/controlled-handoff";
import { REFERRAL_STATUS_CONFIG } from "@/lib/lawyer-referrals/status";

const CONSENT_VERSION = LAWYER_REFERRAL_CONSENT_VERSION;

export function ControlledLawyerReferralPage({ caseId }: { caseId: string }) {
  const { caseData, loading: caseLoading } = useCase(caseId);
  const { files, loading: evidenceLoading } = useEvidence(caseId);
  const { docs, loading: documentsLoading } = useLegalDocuments(caseId);
  const { referrals, loading: referralsLoading, refresh } = useLawyerReferrals(caseId);
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<string[]>([]);
  const [selectedDemandId, setSelectedDemandId] = useState<string | null>(null);
  const [contactMethod, setContactMethod] = useState<ContactMethod>("email");
  const [notes, setNotes] = useState("");
  const [consented, setConsented] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ProfessionalLegalHandoff | null>(null);
  const [requestSelections, setRequestSelections] = useState<Record<string, string[]>>({});
  const [responseNote, setResponseNote] = useState("");

  const issuedDemands = useMemo(() => docs.filter((document) => ["demand_standard", "demand_firm", "demand_final"].includes(document.document_type) && document.issued_at), [docs]);
  const activeReferral = referrals.find((referral) => ACTIVE_REFERRAL_STATUSES.has(referral.referral_status)) ?? created;
  const isEligible = Boolean(caseData && isReferralEligible({ archivedAt: caseData.archived_at, status: caseData.status, balance: caseData.balance }));

  if (caseLoading || evidenceLoading || documentsLoading || referralsLoading) return <LoadingSpinner />;
  if (!caseData) return <main className="px-4 py-16 text-center text-sm text-gray-600">Case not found.</main>;

  async function submit() {
    if (!consented || !isEligible) return;
    setSubmitting(true); setError(null);
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/lawyer-referrals`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consentAccepted: true, consentVersion: CONSENT_VERSION, preferredContactMethod: contactMethod, selectedEvidenceIds, selectedFormalDemandId: selectedDemandId, notes, idempotencyKey: crypto.randomUUID() }),
      });
      const payload = await response.json().catch(() => ({})) as { referral?: LawyerReferralRow; error?: string };
      if (!response.ok || !payload.referral) throw new Error(payload.error ?? "Unable to prepare the professional handoff.");
      setCreated({ ...payload.referral, events: [], documentRequests: [] }); refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to prepare the professional handoff."); }
    finally { setSubmitting(false); }
  }

  async function withdraw() {
    const reason = window.prompt("Why are you withdrawing this legal-review request?")?.trim();
    if (!reason) return;
    setSubmitting(true); setError(null);
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/lawyer-referrals`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "withdraw", reason }) });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to withdraw the request.");
      setCreated(null); refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to withdraw the request."); }
    finally { setSubmitting(false); }
  }

  async function provideDocuments(referralId: string, requestId: string) {
    const evidenceIds = requestSelections[requestId] ?? [];
    if (evidenceIds.length === 0) { setError("Select at least one evidence record for this request."); return; }
    setSubmitting(true); setError(null);
    try {
      const response = await fetch(`/api/legal-handoffs/${encodeURIComponent(referralId)}/document-requests/${encodeURIComponent(requestId)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ evidenceIds, responseNote }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to provide the selected documents.");
      setResponseNote(""); refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to provide the selected documents."); }
    finally { setSubmitting(false); }
  }

  if (activeReferral) return <main className="flex flex-col gap-5 px-4 pb-8 pt-5">
    <Header caseId={caseId} />
    <SectionCard title="Professional Legal Handoff">
      <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
        <p className="font-bold">{REFERRAL_STATUS_CONFIG[activeReferral.referral_status]?.label ?? activeReferral.referral_status.replaceAll("_", " ")}</p>
        <p className="mt-1 text-xs">Package prepared {new Date(activeReferral.data_package_created_at ?? activeReferral.created_at).toLocaleString("en-MY")}.</p>
        <p className="mt-2 text-xs">CollectBoss organizes factual records only. It does not provide legal advice or create legal representation.</p>
      </div>
      <PackageSummary referral={activeReferral} />
      {canWithdrawReferral(activeReferral.referral_status) && <button disabled={submitting} onClick={() => void withdraw()} className="mt-5 text-xs font-semibold text-red-600 underline disabled:opacity-50">Withdraw request</button>}
    </SectionCard>
    {activeReferral.documentRequests.map((documentRequest) => <SectionCard key={documentRequest.id} title="Additional Documents Requested">
      <div className="mt-2 rounded-xl border border-orange-100 bg-orange-50 p-3 text-xs text-orange-900"><p className="font-bold">External professional: {documentRequest.professional_name}, {documentRequest.professional_firm}</p><p className="mt-1 leading-relaxed">{documentRequest.request_message}</p></div>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-gray-600">{(Array.isArray(documentRequest.requested_documents) ? documentRequest.requested_documents : []).map((item, index) => <li key={index}>{String(item)}</li>)}</ul>
      {documentRequest.status === "open" ? <>
        <p className="mt-4 text-xs font-semibold text-gray-700">Select existing case evidence</p>
        <div className="mt-2 space-y-2">{files.map((file) => <label key={file.id} className="flex items-center gap-3 rounded-lg border border-gray-100 p-3 text-xs text-gray-700"><input type="checkbox" checked={(requestSelections[documentRequest.id] ?? []).includes(file.id)} onChange={() => setRequestSelections((current) => { const selected = current[documentRequest.id] ?? []; return { ...current, [documentRequest.id]: selected.includes(file.id) ? selected.filter((id) => id !== file.id) : [...selected, file.id] }; })} /><FileText className="h-4 w-4 text-[#009966]" />{file.file_name}</label>)}</div>
        <Link href={`/evidence/${caseId}`} className="mt-3 inline-block text-xs font-semibold text-[#009966] underline">Upload another document</Link>
        <textarea value={responseNote} onChange={(event) => setResponseNote(event.target.value)} maxLength={1000} rows={2} placeholder="Response note for the external professional (optional)" className="mt-3 w-full rounded-lg border border-gray-200 p-2 text-xs" />
        <PrimaryButton fullWidth disabled={submitting || (requestSelections[documentRequest.id] ?? []).length === 0} onClick={() => void provideDocuments(activeReferral.id, documentRequest.id)}>{submitting ? "Providing documents…" : "Provide selected documents"}</PrimaryButton>
      </> : <p className="mt-3 text-xs font-semibold text-emerald-700">Documents provided {documentRequest.fulfilled_at ? new Date(documentRequest.fulfilled_at).toLocaleString("en-MY") : ""}</p>}
    </SectionCard>)}
    <HandoffTimeline referral={activeReferral} />
    {error && <ErrorNotice error={error} />}
  </main>;

  return <main className="flex flex-col gap-5 px-4 pb-8 pt-5"><Header caseId={caseId} />
    {!isEligible ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Only open cases with a positive outstanding balance can be prepared for legal review.</div> : <>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-800"><strong>Request Legal Review.</strong> This prepares a consent-backed package for an external professional. Until a provider integration records submission, it does not contact a professional, create representation, or share data externally.</div>
      <SectionCard title="Select data for the package"><p className="mt-1 text-xs text-gray-500">The package contains factual balances, statement movements, timeline, selected evidence metadata, and relevant document references. Private storage URLs and internal notes are excluded.</p><div className="mt-3 space-y-2">{files.length ? files.map((file) => <label key={file.id} className="flex items-center gap-3 rounded-lg border border-gray-100 p-3 text-xs text-gray-700"><input type="checkbox" checked={selectedEvidenceIds.includes(file.id)} onChange={() => setSelectedEvidenceIds((current) => current.includes(file.id) ? current.filter((id) => id !== file.id) : [...current, file.id])} /><FileText className="h-4 w-4 text-[#009966]" />{file.file_name}</label>) : <p className="text-xs text-gray-500">No evidence selected.</p>}</div>
        {issuedDemands.length > 0 && <div className="mt-4"><p className="text-xs font-semibold text-gray-700">Issued payment notice (optional)</p>{issuedDemands.map((document) => <label key={document.id} className="mt-2 flex items-center gap-3 text-xs text-gray-700"><input type="radio" name="demand" checked={selectedDemandId === document.id} onChange={() => setSelectedDemandId(document.id)} />{document.title}</label>)}</div>}
      </SectionCard>
      <SectionCard title="Contact and consent"><label className="block text-xs font-semibold text-gray-700">Preferred contact method<select value={contactMethod} onChange={(event) => setContactMethod(event.target.value as ContactMethod)} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm"><option value="email">Email</option><option value="phone">Phone</option><option value="whatsapp">WhatsApp</option></select></label><label className="mt-4 block text-xs font-semibold text-gray-700">Internal note (optional)<textarea value={notes} maxLength={1000} onChange={(event) => setNotes(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm" /></label><label className="mt-4 flex items-start gap-3 rounded-xl border border-gray-100 p-3 text-xs leading-relaxed text-gray-700"><input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} className="mt-0.5" /><span>I confirm I am authorised to request external legal review and consent to the selected factual case data being prepared for a professional handoff. I understand CollectBoss does not provide legal advice and no representation exists unless separately accepted by a qualified professional.</span></label></SectionCard>
      {error && <ErrorNotice error={error} />}
      <PrimaryButton fullWidth size="lg" disabled={!consented || submitting} onClick={() => void submit()} icon={submitting ? <InlineSpinner className="text-white" /> : <Send className="h-4 w-4" />}>{submitting ? "Preparing handoff…" : "Prepare professional handoff"}</PrimaryButton>
    </>}
  </main>;
}

function Header({ caseId }: { caseId: string }) { return <header><Link href={`/cases/${caseId}`} className="inline-flex items-center gap-1 text-xs text-gray-500"><ChevronLeft className="h-4 w-4" />Back to case</Link><h1 className="mt-2 text-lg font-bold text-[#0D1B3D]">Professional Legal Handoff</h1><p className="mt-1 text-xs text-gray-500">Request external legal review with explicit consent and a structured factual package.</p></header>; }
function ErrorNotice({ error }: { error: string }) { return <div className="flex gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>; }

function PackageSummary({ referral }: { referral: ProfessionalLegalHandoff }) {
  const snapshot = referral.data_package_snapshot as Record<string, unknown>;
  const evidence = Array.isArray(snapshot.evidence_list) ? snapshot.evidence_list : Array.isArray(snapshot.evidence) ? snapshot.evidence : [];
  const documents = Array.isArray(snapshot.relevant_documents) ? snapshot.relevant_documents : [];
  const timeline = Array.isArray(snapshot.timeline) ? snapshot.timeline : [];
  const balances = snapshot.balances && typeof snapshot.balances === "object" ? snapshot.balances as Record<string, unknown> : null;
  return <dl className="mt-4 grid grid-cols-2 gap-3 text-xs text-gray-600"><div><dt className="text-gray-400">Outstanding</dt><dd className="font-bold text-gray-800">{balances ? `RM ${(Number(balances.outstanding_minor ?? 0) / 100).toFixed(2)}` : "Legacy package"}</dd></div><div><dt className="text-gray-400">Evidence</dt><dd className="font-bold text-gray-800">{evidence.length} records</dd></div><div><dt className="text-gray-400">Documents</dt><dd className="font-bold text-gray-800">{documents.length} records</dd></div><div><dt className="text-gray-400">Timeline</dt><dd className="font-bold text-gray-800">{timeline.length} events</dd></div><div><dt className="text-gray-400">Shared externally</dt><dd className="font-bold text-gray-800">{referral.shared_at ? "Yes" : "No"}</dd></div><div><dt className="text-gray-400">Consent</dt><dd className="font-bold text-gray-800">{referral.consent_version ?? "Legacy record"}</dd></div></dl>;
}

function HandoffTimeline({ referral }: { referral: ProfessionalLegalHandoff }) {
  if (referral.events.length === 0) return null;
  return <SectionCard title="Handoff Timeline"><ol className="mt-2 space-y-3 border-l-2 border-gray-100 pl-4">{referral.events.map((event) => { const metadata = event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata) ? event.metadata as Record<string, unknown> : {}; const professional = event.actor_type === "professional" ? `${String(metadata.professional_name ?? "External professional")}${metadata.professional_firm ? `, ${String(metadata.professional_firm)}` : ""}` : null; return <li key={event.id} className="text-xs text-gray-600"><div className="flex justify-between gap-3"><strong className="capitalize text-gray-800">{event.event_type.replaceAll("_", " ")}</strong><time className="shrink-0 text-gray-400">{new Date(event.created_at).toLocaleDateString("en-MY")}</time></div>{professional && <p className="mt-1 font-semibold text-purple-700">External professional: {professional}</p>}{typeof metadata.message === "string" && metadata.message && <p className="mt-1 rounded-lg bg-purple-50 p-2 italic text-purple-900">“{metadata.message}”</p>}</li>; })}</ol></SectionCard>;
}
