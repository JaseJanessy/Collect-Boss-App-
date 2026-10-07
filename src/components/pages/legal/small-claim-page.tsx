"use client";
import { friendlyErrorMessage } from "@/lib/ui/friendly-error";

import { useState, useMemo } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SectionCard } from "@/components/ui/section-card";
import { LoadingSpinner, InlineSpinner } from "@/components/ui/loading-spinner";
import { formatRM } from "@/lib/mock-data";
import { useCase } from "@/hooks/use-case";
import { useEvidence } from "@/hooks/use-evidence";
import { usePayments } from "@/hooks/use-payments";
import { useReminders } from "@/hooks/use-reminders";
import { useLegalDocuments } from "@/hooks/use-legal-documents";
import { usePaymentPlans } from "@/hooks/use-payment-plans";
import { type SmallClaimCheckItem } from "@/lib/pdf/small-claim-generator";
import {
  ChevronLeft, CheckCircle2, XCircle, AlertCircle, Info,
  Gavel, FileText, Download, Clock,
} from "lucide-react";

const DISCLAIMER =
  "CollectBoss helps organize documents for your own record keeping and review. " +
  "This is not legal advice and does not submit any claim to court.";

// ─── Readiness status ─────────────────────────────────────────────────────────

type ReadinessStatus = "not_ready" | "almost_ready" | "ready";

export const SMALL_CLAIM_STATUS_CONFIG: Record<
  ReadinessStatus,
  { label: string; color: string; bg: string; border: string }
> = {
  not_ready:    { label: "Not Ready",       color: "text-red-600",    bg: "bg-red-50",    border: "border-red-200"   },
  almost_ready: { label: "Almost Ready",    color: "text-amber-700",  bg: "bg-amber-50",  border: "border-amber-200" },
  ready:        { label: "Ready to Review", color: "text-emerald-700",bg: "bg-emerald-50",border: "border-emerald-200"},
};

// ─── Main component ────────────────────────────────────────────────────────────

interface Props {
  caseId: string;
}

export function SmallClaimPage({ caseId }: Props) {
  const { caseData, loading: caseLoading }   = useCase(caseId);
  const { files }                            = useEvidence(caseId);
  const { payments }                         = usePayments(caseId);
  const { reminders }                        = useReminders(caseId);
  const { docs, addDoc }                     = useLegalDocuments(caseId);
  const { activePlan }                       = usePaymentPlans(caseId);

  const [saving,      setSaving]      = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [saveError,   setSaveError]   = useState<string | null>(null);


  // ── Computed values ───────────────────────────────────────────────────────

  const uploadedTypes = useMemo(
    () => new Set(files.map((f) => f.evidence_type)),
    [files]
  );

  const evidencePacks  = useMemo(() => docs.filter((d) => d.document_type === "evidence_pack"),                           [docs]);
  const formalDemands  = useMemo(() => docs.filter((d) => ["demand_standard","demand_firm","demand_final"].includes(d.document_type)), [docs]);
  const savedSCPacks   = useMemo(() => docs.filter((d) => d.document_type === "small_claim_pack"),                        [docs]);

  // This checks record completeness, not court eligibility.
  const checklist = useMemo<SmallClaimCheckItem[]>(() => {
    if (!caseData) return [];
    return [
      {
        id:    "amount",
        label: "Positive outstanding balance recorded",
        done:  caseData.balance > 0,
      },
      {
        id:    "contact",
        label: "Debtor name and contact available",
        done:  !!(caseData.debtor_name && (caseData.debtor_phone || caseData.debtor_email || caseData.debtor_location)),
      },
      {
        id:    "invoice",
        label: "Invoice or written amount proof uploaded",
        done:  uploadedTypes.has("invoice"),
      },
      {
        id:    "whatsapp",
        label: "WhatsApp or message proof uploaded",
        done:  uploadedTypes.has("whatsapp"),
      },
      {
        id:    "deadline",
        label: "Payment deadline proof available",
        done:  !!(caseData.due_date),
      },
      {
        id:    "reminders",
        label: "Reminder history available",
        done:  reminders.length > 0,
      },
      {
        id:    "payments",
        label: "Payment records updated",
        done:  payments.length > 0,
      },
      {
        id:    "ev_pack",
        label: "Case evidence export generated",
        done:  evidencePacks.length > 0,
      },
      {
        id:    "demand",
        label: "Payment notice draft generated",
        done:  formalDemands.length > 0,
      },
    ];
  }, [caseData, uploadedTypes, reminders.length, payments.length, evidencePacks.length, formalDemands.length]);

  const doneCount     = checklist.filter((i) => i.done).length;
  const readinessPct  = checklist.length > 0 ? Math.round((doneCount / checklist.length) * 100) : 0;
  const readinessStatus: ReadinessStatus =
    readinessPct >= 80 ? "ready" : readinessPct >= 50 ? "almost_ready" : "not_ready";

  const missingItems = checklist.filter((i) => !i.done).map((i) => i.label);

  const FIX_LINKS: Record<string, string> = {
    invoice:   `/evidence/${caseId}`,
    whatsapp:  `/evidence/${caseId}`,
    contact:   `/cases/${caseId}`,
    reminders: `/reminders/${caseId}`,
    payments:  `/payments/record/${caseId}`,
    ev_pack:   `/evidence/${caseId}/pack`,
    demand:    `/legal/${caseId}/demand`,
  };

  // ── Save pack ─────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!caseData) return;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseData.id)}/small-claim-packs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "save" }) });
      const payload = await response.json().catch(() => ({})) as { document?: Parameters<typeof addDoc>[0]; error?: string };
      if (!response.ok || !payload.document) throw new Error(friendlyErrorMessage(payload.error ?? "Unable to save the case-record pack."));
      addDoc(payload.document);
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save the case-record pack.");
    } finally {
      setSaving(false);
    }
  }

  // ── Download PDF ──────────────────────────────────────────────────────────

  async function handleDownload() {
    if (!caseData) return;
    setDownloading(true);
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseData.id)}/small-claim-packs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "issue" }) });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(friendlyErrorMessage(payload.error ?? "Unable to issue the case-record pack."));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a   = document.createElement("a");
      a.href     = url;
      a.download = `case-evidence-export-${caseData.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to issue the case-record pack.");
    } finally {
      setDownloading(false);
    }
  }

  // ── Loading / error ───────────────────────────────────────────────────────

  if (caseLoading) return <LoadingSpinner />;

  if (!caseData) {
    return (
      <div className="px-4 py-16 flex flex-col items-center gap-4">
        <AlertCircle className="w-8 h-8 text-red-400" />
        <p className="text-sm font-semibold text-gray-700">Case not found</p>
        <Link href="/cases" className="text-sm text-[#009966] font-semibold">← Back</Link>
      </div>
    );
  }

  const c       = caseData;
  const statusCfg = SMALL_CLAIM_STATUS_CONFIG[readinessStatus];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col pb-6">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-2 mb-1">
          <Link href={`/cases/${caseId}`} className="text-gray-400 hover:text-gray-600">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-lg font-bold text-[#0D1B3D]">Small Claim Readiness</h1>
        </div>
        <p className="text-xs text-gray-400 ml-7">
          Check factual record completeness and prepare a Case Evidence Export for external review.
        </p>
      </div>

      <div className="px-4 pt-5 flex flex-col gap-5">

        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-1.5"><AlertCircle className="w-5 h-5 text-amber-600" /><p className="text-sm font-black text-amber-800">Legal review required</p></div>
          <p className="text-xs text-amber-700 leading-relaxed">This pack is configured for Malaysia, but CollectBoss does not determine court eligibility, forms, fees, procedure, or deadlines. Verify these with a qualified legal professional and the relevant official authority.</p>
        </div>

        {/* Readiness score */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-bold text-gray-900">Record Completeness</p>
              <p className="text-xs text-gray-400 mt-0.5">{doneCount} of {checklist.length} items complete</p>
            </div>
            <div className="text-right">
              <p className={cn("text-3xl font-black leading-none", statusCfg.color)}>{readinessPct}%</p>
              <span className={cn(
                "text-[10px] font-bold px-2 py-0.5 rounded-full border mt-1 inline-block",
                statusCfg.color, statusCfg.bg, statusCfg.border
              )}>
                {statusCfg.label}
              </span>
            </div>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2.5">
            <div
              className={cn("h-2.5 rounded-full transition-all",
                readinessStatus === "ready"        ? "bg-emerald-500" :
                readinessStatus === "almost_ready" ? "bg-amber-400" : "bg-red-400"
              )}
              style={{ width: `${readinessPct}%` }}
            />
          </div>
        </div>

        {/* Readiness checklist */}
        <SectionCard title="Readiness Checklist">
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
                {!item.done && FIX_LINKS[item.id] && (
                  <Link href={FIX_LINKS[item.id]} className="text-[10px] font-bold text-[#009966] shrink-0 hover:text-emerald-700">
                    Fix →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Missing information list */}
        {missingItems.length > 0 && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            <p className="text-xs font-bold text-red-700 mb-1.5">
              Missing ({missingItems.length}):
            </p>
            <div className="flex flex-col gap-1">
              {missingItems.map((item) => (
                <div key={item} className="flex items-center gap-1.5">
                  <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                  <p className="text-xs text-red-600">{item}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Case summary preview */}
        <SectionCard title="Case Summary">
          <div className="flex flex-col gap-2 mt-2">
            {[
              { label: "Debtor",     value: c.debtor_name },
              ...(c.debtor_company && c.debtor_company !== c.debtor_name ? [{ label: "Company", value: c.debtor_company }] : []),
              ...(c.debtor_reg_no   ? [{ label: "Reg No.", value: c.debtor_reg_no }]   : []),
              ...(c.debtor_phone    ? [{ label: "Phone",   value: c.debtor_phone }]    : []),
              ...(c.debtor_location ? [{ label: "Address", value: c.debtor_location }] : []),
              { label: "Amount Owed",  value: formatRM(c.amount_owed) },
              { label: "Amount Paid",  value: formatRM(c.amount_paid) },
              { label: "Balance Due",  value: formatRM(c.balance) },
              { label: "Due Date",     value: c.due_date },
              ...(c.invoice_no ? [{ label: "Invoice No.", value: c.invoice_no }] : []),
              { label: "Days Overdue", value: c.days_overdue > 0 ? `${c.days_overdue} days` : "Not overdue" },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                <span className="text-xs text-gray-400">{row.label}</span>
                <span className="text-xs font-semibold text-gray-800">{row.value}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Documents & evidence summary */}
        <SectionCard title="Documents & Evidence">
          <div className="flex flex-col gap-2 mt-2">
            {[
              { label: "Evidence Files",       value: `${files.length} file(s)`,        ok: files.length > 0 },
              { label: "Reminders Sent",       value: `${reminders.length}`,             ok: reminders.length > 0 },
              { label: "Payment Records",      value: `${payments.length}`,              ok: payments.length > 0 },
              { label: "Case Evidence Export", value: evidencePacks.length > 0 ? "Generated" : "Not yet",     ok: evidencePacks.length > 0 },
              { label: "Payment Notice",       value: formalDemands.length > 0 ? "Draft saved" : "Not yet",   ok: formalDemands.length > 0 },
              { label: "Payment Plan",         value: activePlan ? "Active" : "None",    ok: !!activePlan },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                <span className="text-xs text-gray-400">{row.label}</span>
                <span className={cn("text-xs font-semibold", row.ok ? "text-emerald-600" : "text-gray-400")}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Reminder history */}
        {reminders.length > 0 && (
          <SectionCard title={`Reminder History (${reminders.length})`}>
            <div className="flex flex-col gap-1.5 mt-2">
              {reminders.slice(0, 4).map((r) => (
                <div key={r.id} className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  <p className="text-xs text-gray-700">{r.message_type} via {r.sent_channel}</p>
                  <span className={cn(
                    "text-[9px] font-bold px-1.5 py-0.5 rounded ml-auto",
                    r.status === "sent" || r.status === "sent_manually" ? "bg-emerald-50 text-emerald-700" : "bg-gray-50 text-gray-500"
                  )}>
                    {r.status}
                  </span>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Payment history */}
        {payments.length > 0 && (
          <SectionCard title={`Payment History (${payments.length})`}>
            <div className="flex flex-col mt-1">
              {payments.slice(0, 4).map((p, i) => (
                <div key={p.id} className={cn("flex items-center justify-between py-2", i < Math.min(payments.length, 4) - 1 && "border-b border-gray-50")}>
                  <div>
                    <p className="text-xs font-semibold text-gray-800">{p.payment_method}</p>
                    <p className="text-[10px] text-gray-400">{new Date(p.created_at).toLocaleDateString("en-MY")}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-emerald-600">{formatRM(p.amount)}</p>
                    <p className={cn("text-[10px] font-semibold",
                      p.review_status === "approved" ? "text-emerald-600" : "text-amber-600"
                    )}>
                      {p.review_status === "approved" ? "Verified" : "Pending"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        <SectionCard title="External Legal-Review Gate">
          <div className="flex flex-col gap-3 mt-2">
            {[
              { step: "1", title: "Complete factual records", sub: "Check every entry against your source documents." },
              { step: "2", title: "Obtain qualified legal review", sub: "Ask counsel to assess the correct forum, legal rights, and limitation periods." },
              { step: "3", title: "Verify current official requirements", sub: "Confirm the applicable forms, fees, procedure, and deadlines externally." },
            ].map((s) => (
              <div key={s.step} className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-[#0D1B3D] text-white text-[11px] font-black flex items-center justify-center shrink-0 mt-0.5">
                  {s.step}
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">{s.title}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{s.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Previously saved packs */}
        {savedSCPacks.length > 0 && (
          <SectionCard title={`Saved Case Evidence Exports (${savedSCPacks.length})`}>
            <div className="flex flex-col gap-2 mt-2">
              {savedSCPacks.map((d) => {
                let meta: { generated_at?: string; readiness_pct?: number; readiness_status?: string; snapshot?: { generatedAt?: string; pdf?: { readinessPct?: number; readinessStatus?: string } } } = {};
                try { meta = JSON.parse(d.content); } catch { /* ignore */ }
                const generatedAt = meta.snapshot?.generatedAt ?? meta.generated_at;
                const readinessPct = meta.snapshot?.pdf?.readinessPct ?? meta.readiness_pct;
                const readinessStatus = meta.snapshot?.pdf?.readinessStatus ?? meta.readiness_status;
                const s = readinessStatus
                  ? SMALL_CLAIM_STATUS_CONFIG[readinessStatus as ReadinessStatus]
                  : null;
                return (
                  <div key={d.id} className="flex items-center gap-3 bg-[#F2F4F7] rounded-xl px-3 py-2.5">
                    <FileText className="w-4 h-4 text-[#009966] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-800 truncate">{d.title}</p>
                      <p className="text-[10px] text-gray-400">
                        {generatedAt
                          ? new Date(generatedAt).toLocaleString("en-MY", { day: "numeric", month: "short", year: "numeric" })
                          : new Date(d.created_at).toLocaleString("en-MY", { day: "numeric", month: "short", year: "numeric" })}
                        {readinessPct != null ? ` · ${readinessPct}% complete` : ""}
                      </p>
                    </div>
                    {d.issued_at && <a href={`/api/cases/${encodeURIComponent(caseId)}/small-claim-packs/${encodeURIComponent(d.id)}`} className="text-[10px] font-bold text-[#009966] hover:underline">Download</a>}
                    {s && (
                      <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full border shrink-0", s.color, s.bg, s.border)}>
                        {s.label}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </SectionCard>
        )}

        {/* Save error */}
        {saveError && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
            <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
            <p className="text-xs text-red-700">{saveError}</p>
          </div>
        )}

        {/* Saved success */}
        {saved && (
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <p className="text-xs text-emerald-700 font-semibold">Immutable snapshot saved · audit log created</p>
          </div>
        )}

        {/* Disclaimer */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex gap-2">
          <Info className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-gray-500 leading-relaxed">
            <strong>{DISCLAIMER}</strong>{" "}
            A qualified legal professional must review court-specific requirements before any action.
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-2">
          <PrimaryButton
            fullWidth size="lg"
            onClick={handleSave}
            disabled={saving}
            icon={saving ? <InlineSpinner className="text-white" /> : <FileText className="w-4 h-4" />}
          >
            {saving ? "Saving…" : saved ? "Save Again" : "Save Readiness Snapshot"}
          </PrimaryButton>

          <PrimaryButton
            fullWidth variant="secondary" size="lg"
            onClick={handleDownload}
            disabled={downloading}
            icon={downloading ? <InlineSpinner className="text-gray-600" /> : <Download className="w-4 h-4" />}
          >
            {downloading ? "Generating PDF…" : "Export Case Evidence PDF"}
          </PrimaryButton>

          <Link href={`/legal/${caseId}/lawyer`}>
            <PrimaryButton fullWidth variant="ghost" size="lg" icon={<Gavel className="w-4 h-4" />}>
              Request Legal Review
            </PrimaryButton>
          </Link>
        </div>
      </div>
    </div>
  );
}
