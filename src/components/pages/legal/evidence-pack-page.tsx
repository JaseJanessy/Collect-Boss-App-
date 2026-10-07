"use client";
import { friendlyErrorMessage } from "@/lib/ui/friendly-error";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SectionCard } from "@/components/ui/section-card";
import { PrimaryButton } from "@/components/ui/primary-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { LoadingSpinner, InlineSpinner } from "@/components/ui/loading-spinner";
import { formatRM } from "@/lib/mock-data";
import {
  evidenceTypes,
  mockCaseTimelines,
} from "@/lib/mock-legal-data";
import { type EvidenceType as DbEvidenceType } from "@/lib/supabase/types";
import { useCase } from "@/hooks/use-case";
import { useEvidence } from "@/hooks/use-evidence";
import { usePayments } from "@/hooks/use-payments";
import { useReminders } from "@/hooks/use-reminders";
import { usePaymentPlans } from "@/hooks/use-payment-plans";
import { useLegalDocuments } from "@/hooks/use-legal-documents";
import { formatFileSize } from "@/lib/db/evidence-client";
import { track } from "@/lib/analytics/tracker";
import { useEntitlements } from "@/hooks/use-entitlements";
import { UsageMeter } from "@/components/billing/usage-meter";
import { PAYMENT_METHOD_LABELS } from "@/lib/db/payments-client";
import {
  ChevronLeft, FileText, Download, MapPin, Phone, Calendar,
  CheckCircle2, MessageCircle, Send, Building2,
  AlertCircle, Image, Info, XCircle,
} from "lucide-react";

interface Props {
  caseId: string;
}

export function EvidencePackPage({ caseId }: Props) {
  const { caseData, loading: caseLoading }         = useCase(caseId);
  const { files, loading: filesLoading }           = useEvidence(caseId);
  const { payments }                               = usePayments(caseId);
  const { reminders }                              = useReminders(caseId);
  const { activePlan }                             = usePaymentPlans(caseId);
  const { docs, refresh: refreshDocuments }        = useLegalDocuments(caseId);
  const { entitlement }                            = useEntitlements();

  const [exporting,   setExporting]   = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [pdfBlob,     setPdfBlob]     = useState<Blob | null>(null);
  const [pdfUrl,      setPdfUrl]      = useState<string | null>(null);
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<string[] | null>(null);

  const loading = caseLoading || filesLoading;
  const timeline = mockCaseTimelines[caseId] ?? [];
  const effectiveSelectedEvidenceIds = selectedEvidenceIds ?? files.map((file) => file.id);

  if (loading) {
    return (
      <div className="flex flex-col pb-6">
        <div className="bg-white border-b border-gray-100 px-4 py-4">
          <h1 className="text-base font-bold text-[#0D1B3D]">Case Evidence Export Preview</h1>
        </div>
        <LoadingSpinner />
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

  const c = caseData;

  // ── Evidence completeness ─────────────────────────────────────────────────────
  const uploadedTypes  = new Set(files.map((f) => f.evidence_type));
  const mustHaveTypes  = evidenceTypes.filter((t) => t.category === "must_have");
  const missingMust    = mustHaveTypes.filter((t) => !uploadedTypes.has(t.id as DbEvidenceType));
  const score          = Math.round((uploadedTypes.size / evidenceTypes.length) * 100);
  const hasMissing     = missingMust.length > 0;

  // Already-exported packs for this case
  const exportedPacks = docs.filter((d) => d.document_type === "evidence_pack");

  // Pack usage display (current case only — server validates total)
  const packLimit   = entitlement?.evidence_pack_limit ?? 1;
  const packCount   = exportedPacks.length;

  async function handleExport() {
    setExporting(true);
    setExportError(null);

    // ── Server-side limit check ──────────────────────────────────────────────
    try {
      const checkRes = await fetch("/api/billing/validate-action", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action: "export_evidence_pack" }),
      });
      if (checkRes.ok) {
        const checkData = await checkRes.json() as { allowed: boolean; reason?: string };
        if (!checkData.allowed) {
          setExportError(checkData.reason ?? "You have reached your plan limit.");
          setExporting(false);
          return;
        }
      }
    } catch {
      // Network error — continue
    }

    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(c.id)}/evidence-pack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evidenceIds: effectiveSelectedEvidenceIds, generationKey: crypto.randomUUID() }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(friendlyErrorMessage(payload.error ?? "Export failed."));
      }
      const packBlob = await response.blob();
      if (pdfUrl) URL.revokeObjectURL(pdfUrl!);
      setPdfBlob(packBlob);
      setPdfUrl(URL.createObjectURL(packBlob));
      refreshDocuments();
      track("evidence_pack_exported", { case_id: c.id, evidence_score: score, file_count: effectiveSelectedEvidenceIds.length });
      setExporting(false);
      return;

      /* Legacy client-side generation is intentionally disabled. The server route
         above authorizes the selection, creates the manifest, persists the audit
         record, and returns the private no-store PDF response.
      const bId = "legacy-client-export";

      const packData: EvidencePackData = {
        caseId:            c.id,
        businessName:      "My Business",
        debtorName:        c.debtor_name,
        debtorCompany:     c.debtor_company,
        debtorRegNo:       c.debtor_reg_no,
        debtorPhone:       c.debtor_phone,
        debtorEmail:       c.debtor_email,
        debtorLocation:    c.debtor_location,
        amountOwed:        c.amount_owed,
        amountPaid:        c.amount_paid,
        balance:           c.balance,
        dueDate:           c.due_date,
        invoiceNo:         c.invoice_no,
        daysOverdue:       c.days_overdue,
        status:            c.status,
        paymentLockMode:   c.payment_lock_mode,
        reminders: reminders.map((r) => ({
          sent_at:      r.sent_at,
          sent_channel: r.sent_channel,
          message_type: r.message_type,
          status:       r.status,
        })),
        payments: payments.map((p) => ({
          created_at:     p.created_at,
          amount:         p.amount,
          payment_method: p.payment_method,
          reference_no:   p.reference_no,
          review_status:  p.review_status,
        })),
        evidenceFiles: files.map((f) => ({
          file_name:       f.file_name,
          file_type:       f.file_type,
          evidence_type:   f.evidence_type,
          file_size_bytes: f.file_size_bytes,
          uploaded_at:     f.uploaded_at,
        })),
        uploadedEvidenceTypes: Array.from(uploadedTypes),
        missingMustHave:       missingMust.map((t) => t.name),
        evidenceScore:         score,
        activePlan: activePlan ? {
          total_amount:       activePlan!.total_amount,
          installment_count:  activePlan!.installment_count,
          installment_amount: activePlan!.installment_amount,
          due_dates:          activePlan!.due_dates,
          debtor_confirmed:   activePlan!.debtor_confirmed,
          confirmed_at:       activePlan!.confirmed_at,
        } : null,
        timeline,
        hasAcknowledgement: false,
      };

      const blob = await generateEvidencePackPdf(packData);

      // Revoke old URL
      if (pdfUrl) URL.revokeObjectURL(pdfUrl!);
      const url = URL.createObjectURL(blob);
      setPdfBlob(blob);
      setPdfUrl(url);

      // Save record to legal_documents
      const title = `Evidence Pack — ${c.debtor_name} — ${new Date().toLocaleDateString("en-MY")}`;
      const saveResult = await saveEvidencePackClient({
        case_id:       c.id,
        title,
        document_type: "evidence_pack",
        content:       JSON.stringify({
          generated_at:    new Date().toISOString(),
          evidence_score:  score,
          file_count:      files.length,
          payment_count:   payments.length,
          reminder_count:  reminders.length,
        }),
      });

      if (saveResult.data) refreshDocuments();

      // Audit log
      await appendAuditLogClient({
        business_id: bId,
        case_id:     c.id,
        action:      "evidence_pack.exported",
        actor_type:  "owner",
        metadata:    {
          evidence_score: score,
          file_count:     files.length,
          missing_must:   missingMust.map((t) => t.id),
        },
      });

      track("evidence_pack_exported", {
        case_id:        c.id,
        evidence_score: score,
        file_count:     files.length,
      });
      */

    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed.");
    }

    setExporting(false);
  } // end handleExport outer try/catch already wraps inner — safe

  function handleDownload() {
    if (!pdfBlob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(pdfBlob);
    a.download = `evidence-pack-${c.id}.pdf`;
    a.click();
  }

  // ────────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col pb-6">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href={`/evidence/${caseId}/checklist`} className="text-gray-400 hover:text-gray-600">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-base font-bold text-[#0D1B3D]">Case Evidence Export Preview</h1>
              <p className="text-[11px] text-gray-400">{files.length} document{files.length !== 1 ? "s" : ""} · {score}% complete</p>
            </div>
          </div>

          {/* Export / Download button */}
          {pdfUrl ? (
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 text-xs font-bold text-white bg-[#009966] px-3 py-2 rounded-xl hover:bg-emerald-700 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download PDF
            </button>
          ) : (
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-1.5 text-xs font-bold text-white bg-[#0D1B3D] px-3 py-2 rounded-xl hover:bg-navy-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {exporting ? <InlineSpinner className="text-white" /> : <FileText className="w-3.5 h-3.5" />}
              {exporting ? "Generating…" : "Export PDF"}
            </button>
          )}
        </div>
      </div>

      <div className="px-4 pt-4 flex flex-col gap-4">

        {/* Export error */}
        {exportError && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
            <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
            <p className="text-xs text-red-700">{exportError}</p>
          </div>
        )}

        {/* PDF ready banner */}
        {pdfUrl && (
          <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3">
            <CheckCircle2 className="w-5 h-5 text-[#009966] shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-bold text-emerald-800">PDF ready to download</p>
              <p className="text-[11px] text-emerald-700">Record saved · Audit log created</p>
            </div>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 text-xs font-bold text-[#009966] border border-emerald-300 bg-white px-3 py-1.5 rounded-xl hover:bg-emerald-50"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </button>
          </div>
        )}

        {/* Missing documents warning */}
        {hasMissing && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2 mb-1.5">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
              <p className="text-xs font-bold text-red-700">
                {missingMust.length} must-have document{missingMust.length > 1 ? "s" : ""} missing
              </p>
            </div>
            <div className="flex flex-col gap-1">
              {missingMust.map((t) => (
                <div key={t.id} className="flex items-center gap-2">
                  <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                  <p className="text-xs text-red-600">{t.name}</p>
                </div>
              ))}
            </div>
            <Link
              href={`/evidence/${caseId}`}
              className="text-xs text-[#009966] font-semibold mt-2 inline-block"
            >
              Upload missing documents →
            </Link>
          </div>
        )}

        {/* Evidence score */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-bold text-gray-900">Evidence Completeness</p>
            <span className={cn(
              "text-sm font-black",
              score >= 60 ? "text-emerald-600" : score >= 30 ? "text-amber-500" : "text-red-500"
            )}>
              {score}%
            </span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className={cn("h-2 rounded-full transition-all", score >= 60 ? "bg-[#009966]" : score >= 30 ? "bg-amber-400" : "bg-red-400")}
              style={{ width: `${score}%` }}
            />
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5">
            {uploadedTypes.size} of {evidenceTypes.length} evidence types uploaded
          </p>
        </div>

        {/* Previously exported packs */}
        {exportedPacks.length > 0 && (
          <SectionCard title={`Previously Exported (${exportedPacks.length})`}>
            <div className="flex flex-col gap-2 mt-2">
              {exportedPacks.map((d) => {
                let meta: { generated_at?: string; evidence_score?: number; file_count?: number } = {};
                try { meta = JSON.parse(d.content); } catch { /* ignore */ }
                return (
                  <div key={d.id} className="flex items-center gap-3 bg-[#F2F4F7] rounded-xl px-3 py-2.5">
                    <FileText className="w-4 h-4 text-[#009966] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-800 truncate">{d.title}</p>
                      <p className="text-[10px] text-gray-400">
                        {meta.generated_at
                          ? new Date(meta.generated_at).toLocaleString("en-MY")
                          : new Date(d.created_at).toLocaleString("en-MY")}
                        {meta.evidence_score != null && ` · ${meta.evidence_score}% complete`}
                        {meta.file_count != null && ` · ${meta.file_count} files`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        )}

        {/* Cover: Case summary */}
        <div className="bg-[#0D1B3D] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="w-4 h-4 text-blue-300" />
            <p className="text-[11px] font-bold text-blue-200 uppercase tracking-wide">
              Factual Case Evidence Export
            </p>
          </div>
          <h2 className="text-lg font-black text-white leading-tight">{c.debtor_name}</h2>
          {c.debtor_reg_no && <p className="text-xs text-blue-200 mt-0.5">{c.debtor_reg_no}</p>}
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="bg-white/10 rounded-xl p-3">
              <p className="text-[10px] text-blue-200">Case ID</p>
              <p className="text-sm font-black text-white font-mono">{c.id}</p>
            </div>
            <div className="bg-[#009966]/80 rounded-xl p-3">
              <p className="text-[10px] text-emerald-100">Balance Due</p>
              <p className="text-sm font-black text-white">{formatRM(c.balance)}</p>
            </div>
            <div className="bg-white/10 rounded-xl p-3">
              <p className="text-[10px] text-blue-200">Due Date</p>
              <p className="text-sm font-bold text-white">{c.due_date}</p>
            </div>
            <div className="bg-white/10 rounded-xl p-3">
              <p className="text-[10px] text-blue-200">Days Overdue</p>
              <p className="text-sm font-bold text-red-300">
                {c.days_overdue > 0 ? `${c.days_overdue} days` : "Not overdue"}
              </p>
            </div>
          </div>
        </div>

        {/* Debtor details */}
        <SectionCard title="Debtor Details">
          <div className="flex flex-col gap-2.5 mt-2">
            {[
              { icon: <Building2 className="w-3.5 h-3.5" />, label: "Company",  value: c.debtor_company ?? c.debtor_name },
              ...(c.debtor_reg_no   ? [{ icon: <FileText className="w-3.5 h-3.5" />, label: "Reg No.",  value: c.debtor_reg_no }] : []),
              ...(c.debtor_phone    ? [{ icon: <Phone className="w-3.5 h-3.5" />,    label: "Phone",    value: c.debtor_phone }] : []),
              ...(c.debtor_location ? [{ icon: <MapPin className="w-3.5 h-3.5" />,   label: "Location", value: c.debtor_location }] : []),
              ...(c.invoice_no      ? [{ icon: <FileText className="w-3.5 h-3.5" />, label: "Invoice",  value: c.invoice_no }] : []),
              { icon: <Calendar className="w-3.5 h-3.5" />, label: "Due Date",  value: c.due_date },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-2">
                <div className="text-gray-400 shrink-0">{row.icon}</div>
                <span className="text-xs text-gray-400 w-16 shrink-0">{row.label}</span>
                <span className="text-xs font-semibold text-gray-800 flex-1">{row.value}</span>
              </div>
            ))}
            <div className="flex items-center gap-2 pt-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <span className="text-xs text-gray-400 w-16 shrink-0">Status</span>
              <StatusBadge status={c.status} />
            </div>
          </div>
        </SectionCard>

        {/* Financial summary */}
        <SectionCard title="Outstanding Amount">
          <div className="flex flex-col gap-2 mt-2">
            {[
              { label: "Amount Owed",  value: formatRM(c.amount_owed),  color: "" },
              { label: "Amount Paid",  value: formatRM(c.amount_paid),  color: "text-emerald-600" },
              { label: "Balance Due",  value: formatRM(c.balance),      color: c.balance > 0 ? "text-red-600 font-black" : "text-emerald-600" },
              { label: "Payment Lock", value: c.payment_lock_mode === "approval" ? "Requires Approval" : c.payment_lock_mode === "immediate" ? "Immediate" : "Manual", color: "" },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                <span className="text-xs text-gray-400">{row.label}</span>
                <span className={cn("text-sm font-semibold text-gray-800", row.color)}>{row.value}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Reminder history */}
        <SectionCard title={`Reminder History (${reminders.length})`}>
          {reminders.length === 0 ? (
            <p className="text-xs text-gray-400 mt-2">No reminders sent.</p>
          ) : (
            <div className="flex flex-col gap-1.5 mt-2">
              {reminders.map((r) => (
                <div key={r.id} className="flex items-start gap-2.5">
                  <MessageCircle className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-gray-700">{r.message_type} via {r.sent_channel}</p>
                    <p className="text-[10px] text-gray-400">{r.sent_at} · {r.status}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Payment history */}
        <SectionCard title={`Payment History (${payments.length})`}>
          {payments.length === 0 ? (
            <p className="text-xs text-gray-400 mt-2">No payment records.</p>
          ) : (
            <div className="flex flex-col mt-1">
              {payments.map((p, i) => (
                <div key={p.id} className={cn("flex items-center justify-between py-2.5", i < payments.length - 1 && "border-b border-gray-50")}>
                  <div>
                    <p className="text-xs font-semibold text-gray-800">
                      {PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      {new Date(p.created_at).toLocaleDateString("en-MY")}
                      {p.reference_no ? ` · Ref: ${p.reference_no}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-emerald-600">{formatRM(p.amount)}</p>
                    <p className={cn("text-[10px] font-semibold",
                      p.review_status === "approved" ? "text-emerald-600" : "text-amber-600"
                    )}>
                      {p.review_status === "approved" ? "Verified" : "Pending Review"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Evidence checklist */}
        <SectionCard title="Evidence Checklist">
          <div className="flex flex-col gap-2 mt-2">
            {evidenceTypes.map((type) => {
              const isUploaded = uploadedTypes.has(type.id as DbEvidenceType);
              const typeFiles  = files.filter((f) => f.evidence_type === type.id);
              return (
                <div key={type.id} className="flex items-center gap-2.5">
                  {isUploaded
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    : <XCircle className={cn("w-4 h-4 shrink-0", type.category === "must_have" ? "text-red-400" : "text-gray-300")} />
                  }
                  <span className="text-sm">{type.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800">{type.name}</p>
                    {isUploaded && typeFiles.length > 0 && (
                      <p className="text-[10px] text-emerald-600">{typeFiles.length} file{typeFiles.length > 1 ? "s" : ""}</p>
                    )}
                  </div>
                  {type.category === "must_have" && !isUploaded && (
                    <span className="text-[9px] font-bold text-red-500 bg-red-50 border border-red-100 px-1.5 py-0.5 rounded">
                      MUST HAVE
                    </span>
                  )}
                  {type.category === "must_have" && isUploaded && (
                    <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                      ✓
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </SectionCard>

        {/* Uploaded documents */}
        <SectionCard title={`Uploaded Documents (${files.length})`}>
          {files.length > 0 && (
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] text-gray-500">Choose the files included in the server-generated manifest.</p>
              <button
                type="button"
                onClick={() => setSelectedEvidenceIds(effectiveSelectedEvidenceIds.length === files.length ? [] : files.map((file) => file.id))}
                className="text-[11px] font-semibold text-[#009966]"
              >
                {effectiveSelectedEvidenceIds.length === files.length ? "Clear all" : "Select all"}
              </button>
            </div>
          )}
          {files.length === 0 ? (
            <div className="py-4 text-center">
              <p className="text-xs text-gray-400">No documents uploaded yet.</p>
              <Link href={`/evidence/${caseId}`} className="text-xs text-[#009966] font-semibold mt-1 inline-block">
                Upload documents →
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-2 mt-2">
              {files.map((f) => {
                const type = evidenceTypes.find((e) => e.id === f.evidence_type);
                const uploadedDate = new Date(f.uploaded_at).toLocaleDateString("en-MY", {
                  day: "numeric", month: "short", year: "numeric",
                });
                return (
                  <div key={f.id} className="flex items-center gap-3 bg-[#F2F4F7] rounded-xl p-3">
                    <input
                      type="checkbox"
                      aria-label={`Include ${f.file_name} in evidence pack`}
                      checked={effectiveSelectedEvidenceIds.includes(f.id)}
                      onChange={() => setSelectedEvidenceIds((current) => {
                        const next = current ?? files.map((file) => file.id);
                        return next.includes(f.id) ? next.filter((id) => id !== f.id) : [...next, f.id];
                      })}
                      className="h-4 w-4 accent-[#009966]"
                    />
                    <div className="w-8 h-8 bg-white rounded-lg border border-gray-100 flex items-center justify-center shrink-0">
                      {f.file_type === "PDF"
                        ? <FileText className="w-4 h-4 text-red-500" />
                        : <Image className="w-4 h-4 text-blue-500" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-800 truncate">{f.file_name}</p>
                      <p className="text-[10px] text-gray-400">
                        {type?.name ?? f.evidence_type} · {formatFileSize(f.file_size_bytes)} · {uploadedDate}
                      </p>
                    </div>
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

        {/* Payment plan summary */}
        {activePlan && (
          <SectionCard title="Active Payment Plan">
            <div className="flex flex-col gap-2 mt-2">
              {[
                { label: "Total",      value: formatRM(activePlan.total_amount) },
                { label: "Instalments", value: `${activePlan.installment_count} × ${formatRM(activePlan.installment_amount)}` },
                { label: "Debtor",     value: activePlan.debtor_confirmed ? "Confirmed" : "Awaiting confirmation" },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                  <span className="text-xs text-gray-400">{row.label}</span>
                  <span className="text-xs font-semibold text-gray-800">{row.value}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Case timeline */}
        {timeline.length > 0 && (
          <SectionCard title="Case Timeline">
            <div className="flex flex-col mt-2 relative">
              <div className="absolute left-[13px] top-2 bottom-2 w-px bg-gray-100" />
              {timeline.map((entry, i) => (
                <div key={i} className="flex gap-3 mb-3 relative">
                  <div className="w-7 h-7 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0 z-10" />
                  <div className="flex-1 pb-0.5">
                    <p className="text-[10px] text-gray-400 font-medium">{entry.date}</p>
                    <p className="text-xs font-semibold text-gray-800 mt-0.5 leading-snug">{entry.event}</p>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Legal disclaimer */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex gap-2">
          <Info className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-gray-500 leading-relaxed">
            <strong>CollectBoss helps organize case records and documents. This document is not legal advice.</strong>{" "}
            Consult a qualified lawyer before taking legal action.
          </p>
        </div>

        {/* Evidence pack usage meter */}
        {packLimit !== -1 && (
          <UsageMeter
            label="Evidence packs (plan total)"
            current={packCount}
            limit={packLimit}
          />
        )}

        {/* Export button (bottom) */}
        {!pdfUrl ? (
          <PrimaryButton
            fullWidth size="lg"
            onClick={handleExport}
            disabled={exporting}
            icon={exporting ? <InlineSpinner className="text-white" /> : <FileText className="w-4 h-4" />}
          >
            {exporting ? "Generating PDF…" : "Export Case Evidence as PDF"}
          </PrimaryButton>
        ) : (
          <div className="flex flex-col gap-2">
            <PrimaryButton fullWidth size="lg" onClick={handleDownload} icon={<Download className="w-4 h-4" />}>
              Download PDF
            </PrimaryButton>
            <PrimaryButton fullWidth variant="ghost" onClick={handleExport} disabled={exporting}
              icon={exporting ? <InlineSpinner className="text-white" /> : <FileText className="w-4 h-4" />}
            >
              {exporting ? "Regenerating…" : "Regenerate PDF"}
            </PrimaryButton>
          </div>
        )}

        {/* Next actions */}
        <div className="flex flex-col gap-2">
          <Link href={`/legal/${caseId}/demand`}>
            <button className="w-full flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3.5 hover:border-[#009966] hover:bg-emerald-50 transition-all">
              <div className="flex items-center gap-2.5">
                <Send className="w-4 h-4 text-[#009966]" />
                <p className="text-sm font-bold text-gray-800">Prepare Formal Payment Reminder</p>
              </div>
              <ChevronRightIcon className="w-4 h-4 text-gray-400" />
            </button>
          </Link>
          <Link href={`/legal/${caseId}/lawyer`}>
            <button className="w-full flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3.5 hover:border-[#009966] hover:bg-emerald-50 transition-all">
              <div className="flex items-center gap-2.5">
                <Building2 className="w-4 h-4 text-[#009966]" />
                <p className="text-sm font-bold text-gray-800">Request Legal Review</p>
              </div>
              <ChevronRightIcon className="w-4 h-4 text-gray-400" />
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}
