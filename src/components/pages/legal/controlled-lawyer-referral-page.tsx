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
import { ACTIVE_REFERRAL_STATUSES, isReferralEligible, LAWYER_REFERRAL_CONSENT_VERSION } from "@/lib/lawyer-referrals/controlled-handoff";

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
  const [created, setCreated] = useState<LawyerReferralRow | null>(null);

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
      if (!response.ok || !payload.referral) throw new Error(payload.error ?? "Unable to request legal review.");
      setCreated(payload.referral); refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to request legal review.");
    } finally { setSubmitting(false); }
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

  if (activeReferral) return (
    <main className="flex flex-col gap-5 px-4 pb-8 pt-5">
      <Header caseId={caseId} />
      <SectionCard title="Legal-review request">
        <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
          <p className="font-bold">{activeReferral.referral_status.replaceAll("_", " ")}</p>
          <p className="mt-1 text-xs">Package created {new Date(activeReferral.data_package_created_at ?? activeReferral.created_at).toLocaleString("en-MY")}. No lawyer or provider has accepted this matter through CollectBoss.</p>
        </div>
        <dl className="mt-4 space-y-2 text-xs text-gray-600"><div className="flex justify-between gap-3"><dt>Selected evidence</dt><dd>{Array.isArray((activeReferral.data_package_snapshot as { evidence?: unknown[] }).evidence) ? (activeReferral.data_package_snapshot as { evidence: unknown[] }).evidence.length : 0} records</dd></div><div className="flex justify-between gap-3"><dt>Consent version</dt><dd>{activeReferral.consent_version}</dd></div><div className="flex justify-between gap-3"><dt>Shared externally</dt><dd>{activeReferral.shared_at ? "Yes" : "No"}</dd></div></dl>
        {activeReferral.referral_status !== "accepted" && <button disabled={submitting} onClick={() => void withdraw()} className="mt-5 text-xs font-semibold text-red-600 underline disabled:opacity-50">Withdraw request</button>}
      </SectionCard>
      {error && <ErrorNotice error={error} />}
    </main>
  );

  return (
    <main className="flex flex-col gap-5 px-4 pb-8 pt-5"><Header caseId={caseId} />
      {!isEligible ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Only open cases with a positive outstanding balance can be prepared for legal review.</div> : <>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-800"><strong>Provider handoff is not configured.</strong> This creates an internal, consent-backed request and a minimized package only. It does not contact a lawyer, create representation, or share data externally.</div>
        <SectionCard title="Select data for the package"><p className="mt-1 text-xs text-gray-500">Only selected record metadata is included. File contents and storage URLs are not copied into the package.</p><div className="mt-3 space-y-2">{files.length ? files.map((file) => <label key={file.id} className="flex items-center gap-3 rounded-lg border border-gray-100 p-3 text-xs text-gray-700"><input type="checkbox" checked={selectedEvidenceIds.includes(file.id)} onChange={() => setSelectedEvidenceIds((current) => current.includes(file.id) ? current.filter((id) => id !== file.id) : [...current, file.id])} /><FileText className="h-4 w-4 text-[#009966]" />{file.file_name}</label>) : <p className="text-xs text-gray-500">No evidence selected.</p>}</div>
          {issuedDemands.length > 0 && <div className="mt-4"><p className="text-xs font-semibold text-gray-700">Issued formal demand (optional)</p>{issuedDemands.map((document) => <label key={document.id} className="mt-2 flex items-center gap-3 text-xs text-gray-700"><input type="radio" name="demand" checked={selectedDemandId === document.id} onChange={() => setSelectedDemandId(document.id)} />{document.title}</label>)}</div>}
        </SectionCard>
        <SectionCard title="Contact and consent"><label className="block text-xs font-semibold text-gray-700">Preferred contact method<select value={contactMethod} onChange={(event) => setContactMethod(event.target.value as ContactMethod)} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm"><option value="email">Email</option><option value="phone">Phone</option><option value="whatsapp">WhatsApp</option></select></label><label className="mt-4 block text-xs font-semibold text-gray-700">Internal note (optional)<textarea value={notes} maxLength={1000} onChange={(event) => setNotes(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm" /></label><label className="mt-4 flex items-start gap-3 rounded-xl border border-gray-100 p-3 text-xs leading-relaxed text-gray-700"><input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} className="mt-0.5" /><span>I confirm I am authorised to request legal review and consent to the selected case data being prepared for a future lawyer/provider handoff. I understand no lawyer has accepted this matter and no legal representation is created.</span></label></SectionCard>
        {error && <ErrorNotice error={error} />}
        <PrimaryButton fullWidth size="lg" disabled={!consented || submitting} onClick={() => void submit()} icon={submitting ? <InlineSpinner className="text-white" /> : <Send className="h-4 w-4" />}>{submitting ? "Creating request…" : "Create legal-review request"}</PrimaryButton>
      </>}
    </main>
  );
}

function Header({ caseId }: { caseId: string }) { return <header><Link href={`/cases/${caseId}`} className="inline-flex items-center gap-1 text-xs text-gray-500"><ChevronLeft className="h-4 w-4" />Back to case</Link><h1 className="mt-2 text-lg font-bold text-[#0D1B3D]">Lawyer Referral</h1><p className="mt-1 text-xs text-gray-500">Controlled legal-review request with explicit consent and a minimized data package.</p></header>; }
function ErrorNotice({ error }: { error: string }) { return <div className="flex gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>; }
