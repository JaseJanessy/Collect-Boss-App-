"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SectionCard } from "@/components/ui/section-card";
import { LoadingSpinner, InlineSpinner } from "@/components/ui/loading-spinner";
import { formatRM } from "@/lib/mock-data";
import {
  mockLawyerPartners,
  type LawyerPartner,
} from "@/lib/mock-legal-data";
import { useCase } from "@/hooks/use-case";
import { useEvidence } from "@/hooks/use-evidence";
import { usePayments } from "@/hooks/use-payments";
import { useReminders } from "@/hooks/use-reminders";
import { useLegalDocuments } from "@/hooks/use-legal-documents";
import { useLawyerReferrals } from "@/hooks/use-lawyer-referrals";
import { useBusinessId } from "@/hooks/use-business-id";
import { createReferralClient } from "@/lib/db/lawyer-referrals-client";
import { appendAuditLogClient } from "@/lib/db/audit-logs-client";
import {
  type ContactMethod,
  type LawyerReferralRow,
} from "@/lib/supabase/types";
import {
  ChevronLeft, ChevronRight, Star, MapPin, Phone, CheckCircle2,
  XCircle, AlertCircle, Info, Send, ShieldCheck, ArrowRight,
  FileText, MessageSquare, Mail, Clock, Briefcase,
} from "lucide-react";
import { useEntitlements } from "@/hooks/use-entitlements";
import { LockedFeature } from "@/components/billing/locked-feature";

// ─── Flow steps ───────────────────────────────────────────────────────────────

type Step = "readiness" | "partners" | "summary" | "confirmed";

const STEP_ORDER: Step[] = ["readiness", "partners", "summary", "confirmed"];
const STEP_LABELS: Record<Step, string> = {
  readiness:  "Case Readiness",
  partners:   "Select Partner",
  summary:    "Referral Summary",
  confirmed:  "Submitted",
};

// ─── Referral status config ───────────────────────────────────────────────────

export const REFERRAL_STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; border: string }
> = {
  draft:             { label: "Draft",            color: "text-gray-600",    bg: "bg-gray-50",    border: "border-gray-200"   },
  ready_for_review:  { label: "Ready for Review", color: "text-blue-700",   bg: "bg-blue-50",    border: "border-blue-200"   },
  handoff_pending:   { label: "Handoff Pending",  color: "text-amber-700",  bg: "bg-amber-50",   border: "border-amber-200"  },
  handoff_failed:    { label: "Handoff Failed",   color: "text-red-700",    bg: "bg-red-50",     border: "border-red-200"    },
  submitted:         { label: "Submitted",         color: "text-amber-700",  bg: "bg-amber-50",   border: "border-amber-200"  },
  under_review:      { label: "Under Review",      color: "text-purple-700", bg: "bg-purple-50",  border: "border-purple-200" },
  lawyer_contacted:  { label: "Lawyer Contacted",  color: "text-emerald-700",bg: "bg-emerald-50", border: "border-emerald-200"},
  accepted:          { label: "Accepted",          color: "text-emerald-700",bg: "bg-emerald-50", border: "border-emerald-200"},
  declined:          { label: "Declined",          color: "text-red-700",    bg: "bg-red-50",     border: "border-red-200"    },
  withdrawn:         { label: "Withdrawn",         color: "text-gray-600",   bg: "bg-gray-50",    border: "border-gray-200"   },
  closed:            { label: "Closed",            color: "text-gray-500",   bg: "bg-gray-50",    border: "border-gray-200"   },
};

const LEGAL_DISCLAIMER =
  "CollectBoss helps organize and submit your case information for review. This is not legal advice and does not create a lawyer-client relationship until accepted by a qualified legal professional.";

// ─── Main component ────────────────────────────────────────────────────────────

interface Props {
  caseId: string;
}

export function LawyerReferralPage({ caseId }: Props) {
  const { caseData, loading: caseLoading }  = useCase(caseId);
  const { files }                           = useEvidence(caseId);
  const { payments }                        = usePayments(caseId);
  const { reminders }                       = useReminders(caseId);
  const { docs }                            = useLegalDocuments(caseId);
  const { addReferral }                     = useLawyerReferrals(caseId);
  const businessId                          = useBusinessId();
  const { entitlement, loading: entLoading } = useEntitlements();

  const [step,            setStep]            = useState<Step>("readiness");
  const [selectedPartner, setSelectedPartner] = useState<string | null>(null);
  const [contactMethod,   setContactMethod]   = useState<ContactMethod>("whatsapp");
  const [notes,           setNotes]           = useState("");
  const [attachEvidence,  setAttachEvidence]  = useState(true);
  const [attachDemand,    setAttachDemand]    = useState(true);
  const [submitting,      setSubmitting]      = useState(false);
  const [submitError,     setSubmitError]     = useState<string | null>(null);
  const [confirmed,       setConfirmed]       = useState<LawyerReferralRow | null>(null);

  // ── Readiness computation ─────────────────────────────────────────────────

  const uploadedTypes = useMemo(() => new Set(files.map((f) => f.evidence_type)), [files]);
  const evidencePacks = useMemo(() => docs.filter((d) => d.document_type === "evidence_pack"), [docs]);
  const formalDemands = useMemo(() => docs.filter((d) =>
    ["demand_standard", "demand_firm", "demand_final"].includes(d.document_type)), [docs]);

  const checklist = useMemo(() => {
    if (!caseData) return [];
    return [
      {
        id:      "case_details",
        label:   "Case details completed",
        done:    !!(caseData.debtor_name && caseData.amount_owed > 0),
        weight:  10,
        link:    null as string | null,
      },
      {
        id:      "debtor_contact",
        label:   "Debtor contact available",
        done:    !!(caseData.debtor_phone || caseData.debtor_email),
        weight:  10,
        link:    `/cases/${caseId}`,
      },
      {
        id:      "invoice",
        label:   "Invoice uploaded",
        done:    uploadedTypes.has("invoice"),
        weight:  20,
        link:    `/evidence/${caseId}`,
      },
      {
        id:      "whatsapp",
        label:   "WhatsApp / chat screenshot uploaded",
        done:    uploadedTypes.has("whatsapp"),
        weight:  15,
        link:    `/evidence/${caseId}`,
      },
      {
        id:      "payments",
        label:   "Payment history recorded",
        done:    payments.length > 0,
        weight:  10,
        link:    `/payments/record/${caseId}`,
      },
      {
        id:      "reminders",
        label:   "Reminder history available",
        done:    reminders.length > 0,
        weight:  10,
        link:    `/reminders/${caseId}`,
      },
      {
        id:      "evidence_pack",
        label:   "Evidence pack generated",
        done:    evidencePacks.length > 0,
        weight:  15,
        link:    `/evidence/${caseId}/pack`,
      },
      {
        id:      "formal_demand",
        label:   "Formal demand draft generated",
        done:    formalDemands.length > 0,
        weight:  10,
        link:    `/legal/${caseId}/demand`,
      },
    ];
  }, [caseData, caseId, uploadedTypes, payments.length, reminders.length, evidencePacks.length, formalDemands.length]);

  const readinessScore = useMemo(() =>
    checklist.reduce((sum, item) => sum + (item.done ? item.weight : 0), 0),
    [checklist]
  );

  const readinessLevel = readinessScore >= 70 ? "strong" : readinessScore >= 40 ? "fair" : "weak";

  // ── Submit referral ───────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!caseData || !selectedPartner) return;
    setSubmitting(true);
    setSubmitError(null);

    const partner     = mockLawyerPartners.find((l) => l.id === selectedPartner)!;
    const bId         = businessId ?? "mock-business-id";
    const evPackId    = attachEvidence && evidencePacks.length > 0 ? evidencePacks[0].id : null;
    const demandId    = attachDemand && formalDemands.length > 0   ? formalDemands[0].id  : null;
    const caseSummary = `${caseData.debtor_name} — ${formatRM(caseData.balance)} outstanding — ${caseData.days_overdue} days overdue`;

    const result = await createReferralClient({
      case_id:                 caseData.id,
      business_id:             bId,
      referral_status:         "submitted",
      partner_id:              partner.id,
      partner_name:            partner.name,
      partner_firm:            partner.firm,
      preferred_contact_method: contactMethod,
      case_summary:            caseSummary,
      evidence_pack_id:        evPackId,
      formal_demand_id:        demandId,
      notes:                   notes.trim() || null,
    });

    if (result.error) {
      setSubmitError(result.error);
      setSubmitting(false);
      return;
    }

    addReferral(result.data!);
    setConfirmed(result.data!);

    await appendAuditLogClient({
      business_id: bId,
      case_id:     caseData.id,
      action:      "lawyer_referral.created",
      actor_type:  "owner",
      metadata:    {
        referral_id:   result.data!.id,
        partner_id:    partner.id,
        partner_name:  partner.name,
        readiness_score: readinessScore,
        contact_method: contactMethod,
      },
    });

    setStep("confirmed");
    setSubmitting(false);
  }

  // ── Loading state ─────────────────────────────────────────────────────────

  if (caseLoading || entLoading) return <LoadingSpinner />;

  // ── Feature gate: lawyer referral requires Boss/Pro ───────────────────────
  if (!entitlement?.lawyer_referral_enabled) {
    return (
      <div className="flex flex-col pb-6">
        <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
          <Link href={`/legal/${caseId}/demand`} className="text-gray-400 hover:text-gray-600 text-sm">
            ← Back
          </Link>
          <h1 className="text-lg font-bold text-[#0D1B3D] mt-2">Lawyer Referral</h1>
        </div>
        <div className="px-4 pt-6">
          <LockedFeature
            feature="Lawyer Referral"
            description="Connect with verified Malaysian lawyers who can review your case and advise on formal legal action."
            availableFrom="boss"
            icon={<Briefcase className="w-5 h-5" />}
          />
        </div>
      </div>
    );
  }

  if (!caseData) {
    return (
      <div className="px-4 py-16 flex flex-col items-center gap-4">
        <AlertCircle className="w-8 h-8 text-red-400" />
        <p className="text-sm font-semibold text-gray-700">Case not found</p>
        <Link href="/cases" className="text-sm text-[#009966] font-semibold">← Back to Cases</Link>
      </div>
    );
  }

  const c       = caseData;
  const partner = mockLawyerPartners.find((l) => l.id === selectedPartner) ?? null;

  // ── Step indicator ────────────────────────────────────────────────────────

  const stepIdx = STEP_ORDER.indexOf(step);

  return (
    <div className="flex flex-col pb-6">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-2 mb-1">
          {step === "readiness" || step === "confirmed" ? (
            <Link href={`/legal/${caseId}/demand`} className="text-gray-400 hover:text-gray-600">
              <ChevronLeft className="w-5 h-5" />
            </Link>
          ) : (
            <button onClick={() => setStep(STEP_ORDER[stepIdx - 1])} className="text-gray-400 hover:text-gray-600">
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          <h1 className="text-lg font-bold text-[#0D1B3D]">Lawyer Referral</h1>
        </div>
        <p className="text-xs text-gray-400 ml-7">
          Submit your case for professional legal review.
        </p>

        {/* Step indicator (only during flow) */}
        {step !== "confirmed" && (
          <div className="flex items-center gap-1.5 mt-3 ml-7">
            {(["readiness", "partners", "summary"] as Step[]).map((s, i) => (
              <div key={s} className="flex items-center gap-1.5">
                <div className={cn(
                  "w-2.5 h-2.5 rounded-full transition-all",
                  step === s       ? "bg-[#009966] scale-110" :
                  i < stepIdx      ? "bg-[#009966] opacity-60" : "bg-gray-200"
                )} />
                {i < 2 && <div className={cn("w-5 h-px", i < stepIdx ? "bg-[#009966] opacity-60" : "bg-gray-200")} />}
              </div>
            ))}
            <p className="text-[10px] text-gray-400 ml-1">{STEP_LABELS[step]}</p>
          </div>
        )}
      </div>

      {/* ── Steps ── */}
      {step === "readiness" && (
        <ReadinessStep
          caseId={caseId}
          c={c}
          checklist={checklist}
          readinessScore={readinessScore}
          readinessLevel={readinessLevel}
          existingReferrals={[]} // shown after submit
          onNext={() => setStep("partners")}
        />
      )}

      {step === "partners" && (
        <PartnersStep
          partners={mockLawyerPartners}
          selected={selectedPartner}
          onSelect={setSelectedPartner}
          onNext={() => setStep("summary")}
        />
      )}

      {step === "summary" && (
        <SummaryStep
          c={c}
          partner={partner}
          notes={notes}
          onNotesChange={setNotes}
          contactMethod={contactMethod}
          onContactMethod={setContactMethod}
          attachEvidence={attachEvidence}
          onAttachEvidence={setAttachEvidence}
          hasEvidencePack={evidencePacks.length > 0}
          attachDemand={attachDemand}
          onAttachDemand={setAttachDemand}
          hasFormalDemand={formalDemands.length > 0}
          readinessScore={readinessScore}
          submitting={submitting}
          submitError={submitError}
          onSubmit={handleSubmit}
        />
      )}

      {step === "confirmed" && confirmed && partner && (
        <ConfirmedStep
          c={c}
          referral={confirmed}
          partner={partner}
        />
      )}
    </div>
  );
}

// ─── Step 1: Case Readiness ───────────────────────────────────────────────────

function ReadinessStep({
  caseId, c, checklist, readinessScore, readinessLevel, existingReferrals, onNext,
}: {
  caseId: string;
  c: ReturnType<typeof useCase>["caseData"] & object;
  checklist: Array<{ id: string; label: string; done: boolean; weight: number; link: string | null }>;
  readinessScore: number;
  readinessLevel: "strong" | "fair" | "weak";
  existingReferrals: LawyerReferralRow[];
  onNext: () => void;
}) {
  const scoreColor = readinessLevel === "strong" ? "text-emerald-600" : readinessLevel === "fair" ? "text-amber-500" : "text-red-500";
  const barColor   = readinessLevel === "strong" ? "bg-emerald-500"   : readinessLevel === "fair" ? "bg-amber-400"   : "bg-red-400";
  const levelLabel = readinessLevel === "strong" ? "Strong"           : readinessLevel === "fair" ? "Fair"           : "Needs Work";

  const doneCount = checklist.filter((i) => i.done).length;

  return (
    <div className="px-4 pt-5 flex flex-col gap-5">
      {/* Info */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-3.5 flex gap-2.5">
        <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
        <p className="text-[11px] text-blue-700 leading-relaxed">
          Review your case readiness before submitting to a legal partner.
          A stronger case increases your chances of a successful recovery.
        </p>
      </div>

      {/* Case chip */}
      <div className="bg-[#0D1B3D] rounded-2xl px-4 py-3.5 flex items-center justify-between">
        <div>
          <p className="text-xs text-blue-200 font-semibold truncate max-w-[180px]">{c.debtor_name}</p>
          <p className="text-[10px] text-blue-300 font-mono mt-0.5">{c.id}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-blue-200">Balance Due</p>
          <p className="text-lg font-black text-white">{formatRM(c.balance)}</p>
          {c.days_overdue > 0 && (
            <p className="text-[10px] text-red-300 mt-0.5">{c.days_overdue} days overdue</p>
          )}
        </div>
      </div>

      {/* Readiness score */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold text-gray-800">Readiness Score</p>
          <div className="text-right">
            <p className={cn("text-3xl font-black leading-none", scoreColor)}>{readinessScore}</p>
            <p className={cn("text-[11px] font-bold", scoreColor)}>{levelLabel}</p>
          </div>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2.5 mb-2">
          <div className={cn("h-2.5 rounded-full transition-all", barColor)} style={{ width: `${readinessScore}%` }} />
        </div>
        <p className="text-[11px] text-gray-400">{doneCount} of {checklist.length} items completed</p>
      </div>

      {/* Checklist */}
      <SectionCard title="Case Readiness Checklist">
        <div className="flex flex-col gap-2.5 mt-3">
          {checklist.map((item) => (
            <div key={item.id} className="flex items-center gap-3">
              {item.done
                ? <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500 shrink-0" style={{ width: "18px", height: "18px" }} />
                : <XCircle     className="w-4.5 h-4.5 text-gray-300 shrink-0"     style={{ width: "18px", height: "18px" }} />
              }
              <p className={cn("text-sm flex-1", item.done ? "text-gray-800" : "text-gray-400")}>
                {item.label}
              </p>
              {!item.done && item.link && (
                <Link href={item.link} className="text-[10px] font-bold text-[#009966] hover:text-emerald-700 shrink-0">
                  Fix →
                </Link>
              )}
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Disclaimer */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex gap-2">
        <Info className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-gray-500 leading-relaxed">{LEGAL_DISCLAIMER}</p>
      </div>

      <PrimaryButton
        fullWidth size="lg"
        icon={<ChevronRight className="w-4 h-4" />}
        onClick={onNext}
      >
        Select Legal Partner
      </PrimaryButton>
    </div>
  );
}

// ─── Step 2: Partner selection ────────────────────────────────────────────────

function PartnersStep({
  partners, selected, onSelect, onNext,
}: {
  partners: LawyerPartner[];
  selected: string | null;
  onSelect: (id: string) => void;
  onNext: () => void;
}) {
  return (
    <div className="px-4 pt-5 flex flex-col gap-5">
      <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex gap-2">
        <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-[11px] text-amber-800 leading-relaxed">
          <strong>Placeholder partners only.</strong> These are example listings.
          No real referral is sent until confirmed. Verify credentials independently.
        </p>
      </div>

      <SectionCard title="Legal Partners">
        <p className="text-[11px] text-gray-400 mt-1 mb-3">
          Select a legal partner to review your case. Fees are discussed directly.
        </p>
        <div className="flex flex-col gap-3">
          {partners.map((lawyer) => (
            <LawyerCard
              key={lawyer.id}
              lawyer={lawyer}
              selected={selected === lawyer.id}
              onSelect={() => onSelect(lawyer.id)}
            />
          ))}
        </div>
      </SectionCard>

      <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex gap-2">
        <Info className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-gray-500 leading-relaxed">{LEGAL_DISCLAIMER}</p>
      </div>

      <PrimaryButton
        fullWidth size="lg"
        disabled={!selected}
        icon={<ChevronRight className="w-4 h-4" />}
        onClick={onNext}
      >
        {selected ? "Continue to Summary" : "Select a Partner First"}
      </PrimaryButton>
    </div>
  );
}

// ─── Step 3: Referral summary ─────────────────────────────────────────────────

function SummaryStep({
  c, partner, notes, onNotesChange, contactMethod, onContactMethod,
  attachEvidence, onAttachEvidence, hasEvidencePack,
  attachDemand, onAttachDemand, hasFormalDemand,
  readinessScore, submitting, submitError, onSubmit,
}: {
  c: NonNullable<ReturnType<typeof useCase>["caseData"]>;
  partner: LawyerPartner | null;
  notes: string;
  onNotesChange: (v: string) => void;
  contactMethod: ContactMethod;
  onContactMethod: (m: ContactMethod) => void;
  attachEvidence: boolean;
  onAttachEvidence: (v: boolean) => void;
  hasEvidencePack: boolean;
  attachDemand: boolean;
  onAttachDemand: (v: boolean) => void;
  hasFormalDemand: boolean;
  readinessScore: number;
  submitting: boolean;
  submitError: string | null;
  onSubmit: () => void;
}) {
  return (
    <div className="px-4 pt-5 flex flex-col gap-5">
      {/* Selected partner */}
      {partner && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#0D1B3D] flex items-center justify-center text-white text-sm font-bold shrink-0">
            {partner.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900">{partner.name}</p>
            <p className="text-[11px] text-gray-500">{partner.firm} · {partner.location}</p>
          </div>
          <CheckCircle2 className="w-5 h-5 text-[#009966] shrink-0" />
        </div>
      )}

      {/* Case summary */}
      <SectionCard title="Case Summary">
        <div className="flex flex-col gap-2 mt-2">
          {[
            { label: "Debtor",       value: c.debtor_name },
            { label: "Balance Due",  value: formatRM(c.balance) },
            { label: "Invoice",      value: c.invoice_no ?? "—" },
            { label: "Days Overdue", value: c.days_overdue > 0 ? `${c.days_overdue} days` : "Not overdue" },
            { label: "Readiness",    value: `${readinessScore}/100` },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
              <span className="text-xs text-gray-400">{row.label}</span>
              <span className="text-xs font-semibold text-gray-800">{row.value}</span>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Attach options */}
      <SectionCard title="Include in Referral">
        <div className="flex flex-col gap-4 mt-3">
          <ToggleRow
            label="Attach Evidence Pack Reference"
            sub={hasEvidencePack ? "Evidence pack generated" : "No evidence pack yet"}
            enabled={attachEvidence && hasEvidencePack}
            disabled={!hasEvidencePack}
            onToggle={() => onAttachEvidence(!attachEvidence)}
          />
          <ToggleRow
            label="Attach Formal Demand Reference"
            sub={hasFormalDemand ? "Formal demand draft saved" : "No formal demand yet"}
            enabled={attachDemand && hasFormalDemand}
            disabled={!hasFormalDemand}
            onToggle={() => onAttachDemand(!attachDemand)}
          />
        </div>
      </SectionCard>

      {/* Notes */}
      <SectionCard title="Notes to Lawyer">
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={3}
          placeholder="Add any additional context or instructions for the legal partner…"
          className="mt-2 w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 outline-none focus:ring-2 focus:ring-emerald-200 resize-none"
        />
      </SectionCard>

      {/* Contact method */}
      <SectionCard title="Preferred Contact Method">
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {([
            { id: "whatsapp", label: "WhatsApp",   icon: <MessageSquare className="w-4 h-4" /> },
            { id: "email",    label: "Email",       icon: <Mail className="w-4 h-4" /> },
            { id: "phone",    label: "Phone Call",  icon: <Phone className="w-4 h-4" /> },
          ] as const).map((m) => (
            <button
              key={m.id}
              onClick={() => onContactMethod(m.id)}
              className={cn(
                "flex min-h-11 flex-col items-center justify-center gap-1.5 rounded-xl border-2 py-3 text-xs font-bold transition-all",
                contactMethod === m.id
                  ? "border-[#009966] bg-emerald-50 text-[#009966]"
                  : "border-gray-100 bg-white text-gray-500 hover:border-gray-200"
              )}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>
      </SectionCard>

      {/* What happens next */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
        <p className="text-xs font-bold text-emerald-800 mb-2">What happens next</p>
        <div className="flex flex-col gap-2">
          {[
            "Your case summary is shared with the selected legal partner",
            "The partner reviews and contacts you via your preferred method",
            "You discuss fees and options — no commitment until you agree",
            "No legal action is taken without your explicit approval",
          ].map((s, i) => (
            <div key={s} className="flex items-start gap-2">
              <span className="w-5 h-5 rounded-full bg-[#009966] text-white text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
              <p className="text-[11px] text-emerald-700 leading-relaxed">{s}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Error */}
      {submitError && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
          <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
          <p className="text-xs text-red-700">{submitError}</p>
        </div>
      )}

      {/* Disclaimer */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex gap-2">
        <Info className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-gray-500 leading-relaxed">{LEGAL_DISCLAIMER}</p>
      </div>

      <PrimaryButton
        fullWidth size="lg"
        onClick={onSubmit}
        disabled={submitting}
        icon={submitting ? <InlineSpinner className="text-white" /> : <Send className="w-4 h-4" />}
      >
        {submitting ? "Submitting…" : "Submit Referral"}
      </PrimaryButton>
    </div>
  );
}

// ─── Step 4: Confirmed ────────────────────────────────────────────────────────

function ConfirmedStep({
  c, referral, partner,
}: {
  c: NonNullable<ReturnType<typeof useCase>["caseData"]>;
  referral: LawyerReferralRow;
  partner: LawyerPartner;
}) {
  const cfg = REFERRAL_STATUS_CONFIG[referral.referral_status];
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mb-4">
        <CheckCircle2 className="w-8 h-8 text-[#009966]" />
      </div>
      <h2 className="text-lg font-black text-[#0D1B3D]">Referral Submitted</h2>
      <p className="text-sm text-gray-500 mt-1.5 leading-relaxed max-w-xs">
        Your case has been prepared for review by{" "}
        <strong>{partner.name}</strong> from {partner.firm}.
      </p>

      {/* Referral record */}
      <div className="mt-5 bg-[#F2F4F7] rounded-2xl px-4 py-4 w-full text-left flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400">Referral ID</p>
          <p className="text-xs font-mono font-bold text-gray-700">{referral.id}</p>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400">Debtor</p>
          <p className="text-xs font-bold text-gray-800">{c.debtor_name}</p>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400">Balance</p>
          <p className="text-xs font-bold text-gray-800">{formatRM(c.balance)}</p>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400">Status</p>
          <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border", cfg?.color, cfg?.bg, cfg?.border)}>
            {cfg?.label ?? referral.referral_status}
          </span>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 mt-4 leading-relaxed max-w-xs">
        No legal action is taken without your approval. All fees are agreed
        directly with the legal partner.
      </p>

      <div className="mt-6 w-full flex flex-col gap-2">
        <Link href={`/cases/${c.id}`}>
          <PrimaryButton fullWidth>Back to Case</PrimaryButton>
        </Link>
        <Link href="/documents">
          <PrimaryButton fullWidth variant="ghost">View Documents</PrimaryButton>
        </Link>
      </div>
    </div>
  );
}

// ─── Lawyer card ──────────────────────────────────────────────────────────────

function LawyerCard({
  lawyer, selected, onSelect,
}: {
  lawyer: LawyerPartner;
  selected: boolean;
  onSelect: () => void;
}) {
  const initials = lawyer.name.split(" ").map((w) => w[0]).slice(0, 2).join("");
  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full flex flex-col text-left rounded-2xl border-2 overflow-hidden transition-all",
        selected ? "border-[#009966]" : "border-gray-100 hover:border-gray-200"
      )}
    >
      <div className={cn("px-4 py-3 flex items-start gap-3", selected ? "bg-emerald-50" : "bg-white")}>
        <div className={cn(
          "w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 mt-1",
          selected ? "border-[#009966] bg-[#009966]" : "border-gray-300"
        )}>
          {selected && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
        </div>
        <div className="w-10 h-10 rounded-xl bg-[#0D1B3D] flex items-center justify-center text-white text-sm font-bold shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-1">
            <p className="text-sm font-bold text-gray-900 leading-tight">{lawyer.name}</p>
            {lawyer.badge && (
              <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full shrink-0">
                {lawyer.badge}
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">{lawyer.firm}</p>
          <div className="flex items-center gap-1 mt-1">
            <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
            <span className="text-[11px] font-bold text-gray-700">{lawyer.rating}</span>
            <span className="text-[11px] text-gray-400">({lawyer.reviewCount} reviews)</span>
          </div>
        </div>
      </div>
      <div className="px-4 py-2.5 bg-[#F2F4F7] flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
          <MapPin className="w-3 h-3 text-gray-400 shrink-0" />{lawyer.location}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
          <Briefcase className="w-3 h-3 text-gray-400 shrink-0" />{lawyer.specialisation}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
          <Clock className="w-3 h-3 text-gray-400 shrink-0" />
          Response: 1–2 business days
        </div>
        <div className="flex items-center justify-between mt-1 pt-1.5 border-t border-gray-200">
          <span className="text-[11px] text-gray-400">Languages: {lawyer.languages.join(", ")}</span>
          <span className="text-xs font-black text-[#0D1B3D]">{lawyer.feeRange}</span>
        </div>
      </div>
    </button>
  );
}

// ─── Toggle row ───────────────────────────────────────────────────────────────

function ToggleRow({
  label, sub, enabled, disabled, onToggle,
}: {
  label: string;
  sub: string;
  enabled: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className={cn("text-sm font-semibold", disabled ? "text-gray-400" : "text-gray-800")}>{label}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>
      </div>
      <button
        onClick={onToggle}
        disabled={disabled}
        className={cn(
          "relative w-11 h-6 rounded-full transition-colors shrink-0",
          enabled && !disabled ? "bg-[#009966]" : "bg-gray-200",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <div
          className={cn(
            "absolute bg-white rounded-full top-[3px] transition-transform shadow-sm",
            enabled && !disabled ? "translate-x-[22px]" : "translate-x-[3px]"
          )}
          style={{ width: "18px", height: "18px" }}
        />
      </button>
    </div>
  );
}
