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
import { usePayments } from "@/hooks/use-payments";
import { useReminders } from "@/hooks/use-reminders";
import { useReceivingAccounts } from "@/hooks/use-receiving-accounts";
import { useLegalDocuments } from "@/hooks/use-legal-documents";
import { useBusinessProfile } from "@/hooks/use-business-profile";
import { getDocumentCreditorName } from "@/lib/business-profile/identity";
import { PAYMENT_METHOD_LABELS } from "@/lib/db/payments-client";
import { FORMAL_DEMAND_DISCLAIMER } from "@/lib/formal-demands/template";
import {
  ChevronLeft, FileText, Download, Send, Info, CheckCircle2,
  AlertCircle, Copy, Check, Save,
} from "lucide-react";
import { useEntitlements } from "@/hooks/use-entitlements";
import { LockedFeature } from "@/components/billing/locked-feature";

// ─── Types ────────────────────────────────────────────────────────────────────

type ToneId = "standard" | "firm" | "final";
type DeadlineDays = 3 | 7 | 14;

const TONES = [
  {
    id: "standard" as ToneId,
    label: "Formal Payment Reminder",
    description: "Professional and polite. Suitable for a first written payment notice.",
    tone: "Friendly",
    docType: "demand_standard" as const,
    recommended: true,
  },
  {
    id: "firm" as ToneId,
    label: "Firm Payment Reminder",
    description: "Direct and factual. Use after multiple unsuccessful reminders.",
    tone: "Firm",
    docType: "demand_firm" as const,
  },
  {
    id: "final" as ToneId,
    label: "Final Payment Notice",
    description: "A final factual notice that flags external legal review as a possible next step.",
    tone: "Final",
    docType: "demand_final" as const,
  },
] as const;

const DISCLAIMER = FORMAL_DEMAND_DISCLAIMER;

// ─── Draft builder ────────────────────────────────────────────────────────────

function addDeadlineDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-MY", { day: "numeric", month: "long", year: "numeric" });
}

interface DraftParams {
  tone:               ToneId;
  deadlineDays:       DeadlineDays;
  deadlineDate:       string;
  today:              string;
  caseId:             string;
  debtorName:         string;
  debtorCompany:      string | null;
  amountOwed:         number;
  amountPaid:         number;
  balance:            number;
  dueDate:            string;
  invoiceNo:          string | null;
  reminderCount:      number;
  paymentHistory:     Array<{ date: string; amount: number; method: string; status: string }>;
  includePayment:     boolean;
  bankName:           string;
  accountHolder:      string;
  accountNo:          string;
  duitnowId:          string | null;
  includeEvidenceRef: boolean;
  businessName:       string;
}

function buildDraft(p: DraftParams): string {
  const recipientLine = p.debtorCompany && p.debtorCompany !== p.debtorName
    ? `${p.debtorCompany}\nAttn: ${p.debtorName}`
    : p.debtorName;

  const inv    = p.invoiceNo ? `Invoice No. ${p.invoiceNo}` : `Case Reference ${p.caseId}`;
  const amt    = formatRM(p.balance);
  const partial = p.amountPaid > 0
    ? `\nWe acknowledge receipt of a partial payment of ${formatRM(p.amountPaid)}. The remaining balance of ${amt} is still outstanding.`
    : "";
  const remindersLine = p.reminderCount > 0
    ? `We have previously sent ${p.reminderCount} payment reminder${p.reminderCount > 1 ? "s" : ""} without receiving a satisfactory response.\n`
    : "";

  const paymentInstructions = p.includePayment
    ? `\nPAYMENT DETAILS:\nBank: ${p.bankName}\nAccount Holder: ${p.accountHolder}\nAccount No.: ${p.accountNo}${p.duitnowId ? `\nDuitNow ID: ${p.duitnowId}` : ""}\nReference: ${p.caseId}\n`
    : "";

  const evidenceRef = p.includeEvidenceRef
    ? "\nFor your reference, we maintain a complete record of this matter, including copies of all invoices, delivery confirmations, and prior communications.\n"
    : "";

  const paymentHistorySection =
    p.paymentHistory.length > 0
      ? `\nPayment Record:\n${p.paymentHistory.map(
          (ph) =>
            `  ${ph.date}  ${ph.method}  ${formatRM(ph.amount)}  (${ph.status === "approved" ? "Verified" : "Pending Review"})`
        ).join("\n")}\n`
      : "";

  if (p.tone === "standard") {
    return `FORMAL PAYMENT REMINDER

Date: ${p.today}
Reference: ${p.caseId}

To:
${recipientLine}

RE: Outstanding Payment — ${inv} — ${amt}

Dear ${p.debtorName},

We write to bring to your attention that the above-referenced amount of ${amt} remains outstanding as at ${p.today}.

This relates to ${inv}, which was due on ${p.dueDate}.${partial}
${paymentHistorySection}
${remindersLine}
We kindly request that you arrange settlement of the full outstanding amount of ${amt} within ${p.deadlineDays} days from the date of this notice, by ${p.deadlineDate}.
${paymentInstructions}${evidenceRef}
We hope to resolve this matter amicably. Should you wish to discuss a payment arrangement, please contact us promptly.

Thank you for your attention.

Yours faithfully,

${p.businessName}
Date: ${p.today}

---
${DISCLAIMER}`;
  }

  if (p.tone === "firm") {
    return `FIRM PAYMENT REMINDER

Date: ${p.today}
Reference: ${p.caseId}

To:
${recipientLine}

RE: OVERDUE PAYMENT — ${inv} — ${amt}

Despite our previous communications, the above sum of ${amt} remains unpaid and overdue.

This relates to ${inv}, which was due on ${p.dueDate}.${partial}
${paymentHistorySection}
${remindersLine}
You are hereby formally notified that the full outstanding amount of ${amt} is required to be paid within ${p.deadlineDays} days from the date of this notice, by ${p.deadlineDate}.

If the amount remains unpaid, the creditor may continue factual payment follow-up or request external legal review.
${paymentInstructions}${evidenceRef}
Please treat this matter with urgency.

Yours faithfully,

${p.businessName}
Date: ${p.today}

---
${DISCLAIMER}`;
  }

  // final
  return `FINAL PAYMENT NOTICE

Date: ${p.today}
Reference: ${p.caseId}

To:
${recipientLine}

RE: FINAL NOTICE — ${inv} — ${amt} — IMMEDIATE PAYMENT REQUIRED

This is our FINAL NOTICE regarding the outstanding amount of ${amt}.
${remindersLine ? `\n${remindersLine}` : ""}
This relates to ${inv}, which was due on ${p.dueDate}.${partial}
${paymentHistorySection}
You are required to settle the full outstanding amount of ${amt} within ${p.deadlineDays} days from the date of this notice, by ${p.deadlineDate}.

If payment is not received by the above deadline, the creditor may request external legal review before deciding whether any further action is appropriate.

Please treat this payment notice seriously. You may obtain independent legal advice if you are unsure of your position.
${paymentInstructions}${evidenceRef}
Yours faithfully,

${p.businessName}
Date: ${p.today}

---
${DISCLAIMER}`;
}

// ─── Main component ────────────────────────────────────────────────────────────

interface Props {
  caseId: string;
}

export function FormalDemandPage({ caseId }: Props) {
  const { caseData, loading: caseLoading }      = useCase(caseId);
  const { payments }                            = usePayments(caseId);
  const { reminders }                           = useReminders(caseId);
  const { accounts }                            = useReceivingAccounts();
  const { docs, addDoc, refresh: refreshDocuments } = useLegalDocuments(caseId);
  const { profile }                             = useBusinessProfile();
  const { entitlement, loading: entLoading }    = useEntitlements();

  const [tone,               setTone]               = useState<ToneId>("standard");
  const [deadlineDays,       setDeadlineDays]       = useState<DeadlineDays>(14);
  const [includePayment,     setIncludePayment]     = useState(false);
  const [includeEvidenceRef, setIncludeEvidenceRef] = useState(false);
  const [saving,             setSaving]             = useState(false);
  const [downloading,        setDownloading]        = useState(false);
  const [saved,              setSaved]              = useState(false);
  const [copied,             setCopied]             = useState(false);
  const [saveError,          setSaveError]          = useState<string | null>(null);

  const today        = new Date().toLocaleDateString("en-MY", { day: "numeric", month: "long", year: "numeric" });
  const deadlineDate = addDeadlineDays(deadlineDays);

  const primaryAccount = accounts.find((a) => a.is_primary) ?? accounts[0] ?? null;
  const creditorName = getDocumentCreditorName(profile);

  const approvedPayments = payments.filter((p) => p.review_status === "approved");

  const draft = useMemo<string>(() => {
    if (!caseData) return "";
    return buildDraft({
      tone,
      deadlineDays,
      deadlineDate,
      today,
      caseId:         caseData.id,
      debtorName:     caseData.debtor_name,
      debtorCompany:  caseData.debtor_company,
      amountOwed:     caseData.amount_owed,
      amountPaid:     caseData.amount_paid,
      balance:        caseData.balance,
      dueDate:        caseData.due_date,
      invoiceNo:      caseData.invoice_no,
      reminderCount:  reminders.length,
      paymentHistory: approvedPayments.map((p) => ({
        date:   new Date(p.created_at).toLocaleDateString("en-MY"),
        amount: p.amount,
        method: PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method,
        status: p.review_status,
      })),
      includePayment,
      bankName:       primaryAccount?.bank_name ?? "—",
      accountHolder:  primaryAccount?.account_holder_name ?? "—",
      accountNo:      primaryAccount?.account_number ?? "—",
      duitnowId:      primaryAccount?.duitnow_id ?? null,
      includeEvidenceRef,
      businessName:   creditorName,
    });
  }, [caseData, tone, deadlineDays, deadlineDate, today, reminders.length,
      approvedPayments, includePayment, includeEvidenceRef, primaryAccount, creditorName]);

  const savedDemands = docs.filter((d) =>
    ["demand_standard", "demand_firm", "demand_final"].includes(d.document_type)
  );

  // ── Save draft ────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!caseData) return;
    setSaving(true);
    setSaveError(null);

    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseData.id)}/formal-demands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "draft", tone, deadlineDays, includePayment, includeEvidenceRef }),
      });
      const payload = await response.json().catch(() => ({})) as { document?: Parameters<typeof addDoc>[0]; error?: string };
      if (!response.ok || !payload.document) throw new Error(friendlyErrorMessage(payload.error ?? "Unable to save the payment-notice draft."));
      addDoc(payload.document);
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save the payment-notice draft.");
    } finally {
      setSaving(false);
    }
    /* Legacy browser-only persistence is deliberately disabled. Issuance is
       performed by the authorized server route above.

    const bId = businessId ?? "mock-business-id";

    const toneObj = TONES.find((t) => t.id === tone)!;
    const title   = `${toneObj.label} — ${caseData.debtor_name} — ${today}`;

    const result = await saveEvidencePackClient({
      case_id:       caseData.id,
      title,
      document_type: toneObj.docType,
      content:       JSON.stringify({
        tone,
        deadline_days: deadlineDays,
        deadline_date: deadlineDate,
        generated_at:  new Date().toISOString(),
        draft_text:    draft,
      }),
    });

    if (result.error) {
      setSaveError(result.error);
    } else {
      addDoc(result.data!);
      setSaved(true);
      await appendAuditLogClient({
        business_id: bId,
        case_id:     caseData.id,
        action:      "formal_demand.saved",
        actor_type:  "owner",
        metadata:    { tone, deadline_days: deadlineDays, doc_id: result.data!.id },
      });
    }
    setSaving(false);
    */
  }

  // ── Download PDF ──────────────────────────────────────────────────────────

  async function handleDownload() {
    if (!caseData) return;
    setDownloading(true);
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseData.id)}/formal-demands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "issue", tone, deadlineDays, includePayment, includeEvidenceRef }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(friendlyErrorMessage(payload.error ?? "Unable to issue the payment notice."));
      }
      const blob = await response.blob();
      const documentId = response.headers.get("X-Formal-Demand-Id");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = tone === "final" ? "final-payment-notice.pdf" : "formal-payment-reminder.pdf";
      anchor.click();
      URL.revokeObjectURL(url);
      if (documentId) refreshDocuments();
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to issue the payment notice.");
    } finally {
      setDownloading(false);
    }
    /* Legacy browser-only PDF generation is deliberately disabled.

    try {
      const blob = await generateDemandPdf({
        caseId:       caseData.id,
        businessName: creditorName,
        tone,
        deadlineDays,
        deadlineDate,
        today,
        draftText:    draft,
      });
      const url = URL.createObjectURL(blob);
      const a   = document.createElement("a");
      a.href     = url;
      a.download = `formal-demand-${caseData.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Legacy failure ignored.
    }
    setDownloading(false);
    */
  }

  // ── Copy to clipboard ─────────────────────────────────────────────────────

  function handleCopy() {
    navigator.clipboard.writeText(draft).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ── Loading / error states ────────────────────────────────────────────────

  if (caseLoading || entLoading) return <LoadingSpinner />;

  // ── Feature gate: formal demand requires Boss/Pro plan ──────────────────────
  if (!entitlement?.formal_demand_enabled) {
    return (
      <div className="flex flex-col pb-6">
        <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
          <Link href={`/evidence/${caseId}/pack`} className="text-gray-400 hover:text-gray-600 text-sm">
            ← Back
          </Link>
          <h1 className="text-lg font-bold text-[#0D1B3D] mt-2">Formal Payment Reminder</h1>
        </div>
        <div className="px-4 pt-6">
          <LockedFeature
            feature="Formal Payment Notice"
            description="Prepare a factual written payment reminder or final payment notice from your case records."
            availableFrom="boss"
            icon={<FileText className="w-5 h-5" />}
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

  const c = caseData;

  return (
    <div className="flex flex-col pb-6">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-2 mb-1">
          <Link href={`/evidence/${caseId}/pack`} className="text-gray-400 hover:text-gray-600">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-lg font-bold text-[#0D1B3D]">Formal Payment Reminder</h1>
        </div>
        <p className="text-xs text-gray-400 ml-7">
          Prepare a factual creditor payment notice from the recorded case details.
        </p>
      </div>

      <div className="px-4 pt-5 flex flex-col gap-5">

        {/* Info banner */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-3.5 flex gap-2.5">
          <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-blue-800">What is this?</p>
            <p className="text-[11px] text-blue-700 mt-0.5 leading-relaxed">
              A creditor-authored payment notice prepared from your records. It is not a
              lawyer&apos;s demand or a court document. Review escalation language before sending.
            </p>
          </div>
        </div>

        {/* Case summary */}
        <div className="bg-[#0D1B3D] rounded-2xl px-4 py-3.5 flex items-center justify-between">
          <div>
            <p className="text-xs text-blue-200 font-semibold truncate max-w-[180px]">{c.debtor_name}</p>
            {c.invoice_no && <p className="text-[10px] text-blue-300 mt-0.5">Invoice: {c.invoice_no}</p>}
            <p className="text-[10px] text-blue-300 font-mono mt-0.5">{c.id}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-blue-200">Balance Due</p>
            <p className="text-xl font-black text-white">{formatRM(c.balance)}</p>
            {c.days_overdue > 0 && (
              <p className="text-[10px] text-red-300 mt-0.5">{c.days_overdue} days overdue</p>
            )}
          </div>
        </div>

        {/* Tone selector */}
        <SectionCard title="Notice Style">
          <div className="flex flex-col gap-2 mt-2">
            {TONES.map((t) => (
              <button
                key={t.id}
                onClick={() => { setTone(t.id); setSaved(false); }}
                className={cn(
                  "flex items-start gap-3 p-3.5 rounded-xl border-2 text-left transition-all",
                  tone === t.id ? "border-[#009966] bg-emerald-50" : "border-gray-100 bg-white hover:border-gray-200"
                )}
              >
                <div className={cn(
                  "w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5",
                  tone === t.id ? "border-[#009966] bg-[#009966]" : "border-gray-300"
                )}>
                  {tone === t.id && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold text-gray-900">{t.label}</p>
                    {"recommended" in t && (
                      <span className="text-[9px] font-bold text-[#009966] bg-emerald-100 px-1.5 py-0.5 rounded-full">
                        Recommended
                      </span>
                    )}
                    <span className="text-[10px] text-gray-400 ml-auto">Tone: {t.tone}</span>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-0.5">{t.description}</p>
                </div>
              </button>
            ))}
          </div>
        </SectionCard>

        {tone === "final" && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-800">
            <strong>Legal review flag:</strong> this version mentions possible external legal review. CollectBoss does not decide whether legal action is available or appropriate.
          </div>
        )}

        {/* Deadline selector */}
        <SectionCard title="Payment Deadline">
          <div className="grid grid-cols-3 gap-2 mt-2">
            {([3, 7, 14] as DeadlineDays[]).map((d) => (
              <button
                key={d}
                onClick={() => { setDeadlineDays(d); setSaved(false); }}
                className={cn(
                  "py-2.5 rounded-xl text-sm font-bold border-2 transition-all text-center",
                  deadlineDays === d
                    ? "border-[#009966] bg-emerald-50 text-[#009966]"
                    : "border-gray-100 bg-white text-gray-500 hover:border-gray-200"
                )}
              >
                {d} days
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-2">
            Deadline: <strong className="text-gray-700">{deadlineDate}</strong>
          </p>
        </SectionCard>

        {/* Options */}
        <SectionCard title="Options">
          <div className="flex flex-col gap-4 mt-3">
            {/* Payment instructions toggle */}
            <div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-800">Include Payment Instructions</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {primaryAccount
                      ? `${primaryAccount.bank_name} — ${primaryAccount.account_number}`
                      : "No primary account set"}
                  </p>
                </div>
                <button
                  onClick={() => { setIncludePayment((v) => !v); setSaved(false); }}
                  disabled={!primaryAccount}
                  className={cn(
                    "relative w-11 h-6 rounded-full transition-colors shrink-0",
                    includePayment && primaryAccount ? "bg-[#009966]" : "bg-gray-200"
                  )}
                >
                  <div className={cn(
                    "absolute w-4.5 h-4.5 bg-white rounded-full top-[3px] transition-transform shadow-sm",
                    includePayment && primaryAccount ? "translate-x-[22px]" : "translate-x-[3px]"
                  )} style={{ width: "18px", height: "18px" }} />
                </button>
              </div>
              {includePayment && primaryAccount && (
                <div className="mt-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 flex gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-amber-700 leading-relaxed">
                    Payment details will be visible in the letter. Bank details follow the
                    Payment Lock setting of this case.
                  </p>
                </div>
              )}
            </div>

            {/* Evidence pack reference toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-800">Reference Evidence Pack</p>
                <p className="text-[11px] text-gray-400 mt-0.5">Mention that records are maintained</p>
              </div>
              <button
                onClick={() => { setIncludeEvidenceRef((v) => !v); setSaved(false); }}
                className={cn(
                  "relative w-11 h-6 rounded-full transition-colors shrink-0",
                  includeEvidenceRef ? "bg-[#009966]" : "bg-gray-200"
                )}
              >
                <div className={cn(
                  "absolute bg-white rounded-full top-[3px] transition-transform shadow-sm",
                  includeEvidenceRef ? "translate-x-[22px]" : "translate-x-[3px]"
                )} style={{ width: "18px", height: "18px" }} />
              </button>
            </div>
          </div>
        </SectionCard>

        {/* Draft preview */}
        <SectionCard title="Draft Preview">
          <div className="mt-3 bg-[#F2F4F7] rounded-xl p-4 border border-gray-200">
            <div className="text-center mb-4 pb-3 border-b border-gray-300">
              <p className="text-xs font-black text-[#0D1B3D] uppercase tracking-wide">
                {TONES.find((t) => t.id === tone)?.label.toUpperCase()}
              </p>
              <p className="text-[10px] text-gray-500 mt-0.5">Date: {today}</p>
            </div>

            <pre className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-wrap font-sans">
              {draft}
            </pre>
          </div>

          {/* Copy button */}
          <button
            onClick={handleCopy}
            className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 bg-[#F2F4F7] border border-gray-200 rounded-xl text-xs font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied!" : "Copy Draft Text"}
          </button>
        </SectionCard>

        {/* Previously saved payment notices */}
        {savedDemands.length > 0 && (
          <SectionCard title={`Saved Payment Notice Drafts (${savedDemands.length})`}>
            <div className="flex flex-col gap-2 mt-2">
              {savedDemands.map((d) => {
                let meta: { generated_at?: string; tone?: string; deadline_days?: number } = {};
                try { meta = JSON.parse(d.content); } catch { /* ignore */ }
                return (
                  <div key={d.id} className="flex items-center gap-3 bg-[#F2F4F7] rounded-xl px-3 py-2.5">
                    <FileText className="w-4 h-4 text-[#009966] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-800 truncate">{d.title}</p>
                      <p className="text-[10px] text-gray-400">
                        {meta.generated_at
                          ? new Date(meta.generated_at).toLocaleString("en-MY", { day: "numeric", month: "short", year: "numeric" })
                          : new Date(d.created_at).toLocaleString("en-MY", { day: "numeric", month: "short", year: "numeric" })}
                        {meta.deadline_days ? ` · ${meta.deadline_days}-day deadline` : ""}
                      </p>
                    </div>
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
            <p className="text-xs text-emerald-700 font-semibold">Draft saved · Audit log created</p>
          </div>
        )}

        {/* Legal disclaimer */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-800 leading-relaxed">
            <strong>{DISCLAIMER}</strong>
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-2">
          {/* Save Draft */}
          <PrimaryButton
            fullWidth size="lg"
            onClick={handleSave}
            disabled={saving}
            icon={saving ? <InlineSpinner className="text-white" /> : <Save className="w-4 h-4" />}
          >
            {saving ? "Saving…" : saved ? "Save Again" : "Save Draft"}
          </PrimaryButton>

          {/* Download PDF */}
          <PrimaryButton
            fullWidth variant="secondary" size="lg"
            onClick={handleDownload}
            disabled={downloading}
            icon={downloading ? <InlineSpinner className="text-gray-600" /> : <Download className="w-4 h-4" />}
          >
            {downloading ? "Generating PDF…" : "Download as PDF"}
          </PrimaryButton>

          {/* Request external review */}
          <Link href={`/legal/${caseId}/lawyer`}>
            <PrimaryButton fullWidth variant="ghost" size="lg" icon={<Send className="w-4 h-4" />}>
              Request Legal Review
            </PrimaryButton>
          </Link>
        </div>
      </div>
    </div>
  );
}
