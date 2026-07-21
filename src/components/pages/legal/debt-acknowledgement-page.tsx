"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SectionCard } from "@/components/ui/section-card";
import { LoadingSpinner, InlineSpinner } from "@/components/ui/loading-spinner";
import { useCase } from "@/hooks/use-case";
import { usePaymentPlans } from "@/hooks/use-payment-plans";
import { useBusinessId } from "@/hooks/use-business-id";
import { appendAuditLogClient } from "@/lib/db/audit-logs-client";
import { formatDate } from "@/lib/db/payment-plans-client";
import { formatRM } from "@/lib/mock-data";
import {
  ChevronLeft, ShieldCheck, FileText, CheckCircle2,
  Info, PenLine, AlertCircle, ExternalLink, Copy, Check,
} from "lucide-react";

interface Props {
  caseId: string;
}

type PageState = "preview" | "signed";

export function DebtAcknowledgementPage({ caseId }: Props) {
  const { caseData, loading } = useCase(caseId);
  const { activePlan }        = usePaymentPlans(caseId);
  const businessId            = useBusinessId();

  const [state,   setState]   = useState<PageState>("preview");
  const [sigText, setSigText] = useState("");
  const [agreed,  setAgreed]  = useState(false);
  const [saving,  setSaving]  = useState(false);

  const canSign = sigText.trim().length >= 3 && agreed;

  if (loading) return <LoadingSpinner />;
  if (!caseData) {
    return (
      <div className="px-4 py-16 flex flex-col items-center gap-4">
        <AlertCircle className="w-8 h-8 text-red-400" />
        <p className="text-sm font-semibold text-gray-700">Case not found</p>
        <Link href="/cases" className="text-sm text-[#009966] font-semibold">← Back</Link>
      </div>
    );
  }

  const c = caseData;

  async function handleSign() {
    if (!canSign) return;
    setSaving(true);

    await appendAuditLogClient({
      business_id: businessId ?? "mock-business-id",
      case_id:     c.id,
      action:      "acknowledgement.signed",
      actor_type:  "owner",
      metadata:    { creditor_name: sigText.trim(), case_id: c.id },
    });

    setSaving(false);
    setState("signed");
  }

  if (state === "signed") {
    return (
      <div className="flex flex-col items-center px-6 py-12 text-center">
        <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mb-4">
          <CheckCircle2 className="w-8 h-8 text-[#009966]" />
        </div>
        <h2 className="text-lg font-black text-[#0D1B3D]">Acknowledgement Saved</h2>
        <p className="text-sm text-gray-500 mt-1.5 leading-relaxed max-w-xs">
          Confirmed for {c.debtor_name}. You can now share the debtor confirmation link.
        </p>
        <div className="mt-4 bg-[#F2F4F7] rounded-xl p-4 w-full text-left">
          <p className="text-xs text-gray-400">Confirmed by</p>
          <p className="text-sm font-black text-gray-900 mt-0.5">{sigText}</p>
          <p className="text-xs text-gray-400 mt-1">{new Date().toLocaleString("en-MY")}</p>
        </div>

        <div className="mt-4 w-full rounded-xl border border-blue-100 bg-blue-50 p-4 text-left">
          <p className="text-xs font-bold text-blue-800">Public debtor links are tokenized</p>
          <p className="mt-1 text-[11px] text-blue-700">Create a secure acknowledgement link from the payment-plan screen before sharing it.</p>
        </div>

        <div className="mt-6 w-full flex flex-col gap-2">
          <Link href={`/cases/${c.id}`}>
            <PrimaryButton fullWidth>Back to Case</PrimaryButton>
          </Link>
        </div>
      </div>
    );
  }

  const balance = c.balance > 0 ? c.balance : c.amount_owed;

  return (
    <div className="flex flex-col pb-6">
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-2 mb-1">
          <Link href={`/cases/${c.id}`} className="text-gray-400 hover:text-gray-600">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-lg font-bold text-[#0D1B3D]">Debt Acknowledgement</h1>
        </div>
        <p className="text-xs text-gray-400 ml-7">
          Document confirming the outstanding amount and payment arrangement.
        </p>
      </div>

      <div className="px-4 pt-5 flex flex-col gap-5">
        {/* OTP status placeholder */}
        <div className="flex items-center gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <p className="text-xs font-semibold text-amber-800">
            Share the debtor confirmation link once you&apos;ve signed below.
            OTP verification coming in a future update.
          </p>
        </div>

        {/* Document preview */}
        <SectionCard title="Agreement Document">
          <div className="mt-3 bg-[#F2F4F7] rounded-xl p-4 border border-gray-200">
            <div className="text-center mb-4 pb-3 border-b border-gray-200">
              <p className="text-sm font-black text-[#0D1B3D]">DEBT ACKNOWLEDGEMENT</p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                CollectBoss · {new Date().toLocaleDateString("en-MY")}
              </p>
            </div>

            <p className="text-xs text-gray-700 leading-relaxed mb-3">
              This document acknowledges that <strong>{c.debtor_company ?? c.debtor_name}</strong>
              {" "}has an outstanding amount payable as stated below.
            </p>

            <div className="bg-white rounded-lg p-3 mb-3 border border-gray-100">
              <div className="flex flex-col gap-2">
                {[
                  { label: "Case Reference",   value: c.id },
                  ...(c.invoice_no ? [{ label: "Invoice Number", value: c.invoice_no }] : []),
                  { label: "Amount Owed",      value: formatRM(balance) },
                  { label: "Due Date",         value: c.due_date },
                  ...(activePlan ? [
                    { label: "Plan",           value: `${activePlan.installment_count}× ${formatRM(activePlan.installment_amount)}` },
                    { label: "First Due",      value: formatDate(activePlan.due_dates[0] ?? activePlan.start_date) },
                  ] : []),
                ].map((row) => (
                  <div key={row.label} className="flex justify-between items-center border-b border-gray-50 pb-1.5 last:border-0">
                    <span className="text-[11px] text-gray-400">{row.label}</span>
                    <span className="text-xs font-bold text-gray-800">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-xs text-gray-600 leading-relaxed mb-3">
              The debtor acknowledges this outstanding amount and agrees to settle
              it{activePlan ? " according to the agreed payment plan" : " by the payment deadline"}.
            </p>

            {/* Signature placeholder */}
            <div className="border-t border-dashed border-gray-300 pt-3 mt-3">
              <p className="text-[10px] text-gray-400 mb-2">Creditor&apos;s Confirmation</p>
              <div className="w-full h-14 bg-white rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center">
                {sigText ? (
                  <p className="text-base font-bold text-gray-700 italic">{sigText}</p>
                ) : (
                  <div className="flex items-center gap-2 text-gray-300">
                    <PenLine className="w-4 h-4" />
                    <span className="text-xs">Your signature</span>
                  </div>
                )}
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                Date: {new Date().toLocaleDateString("en-MY")}
              </p>
            </div>
          </div>
        </SectionCard>

        {/* Creditor sign-off */}
        <SectionCard title="Your Confirmation">
          <div className="mt-3 flex flex-col gap-4">
            <div>
              <label className="text-sm font-bold text-gray-700 mb-1.5 block">
                Your Full Name (as creditor)
              </label>
              <div className="relative">
                <PenLine className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="e.g. Ahmad bin Ibrahim"
                  value={sigText}
                  onChange={(e) => setSigText(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300"
                />
              </div>
            </div>

            <button onClick={() => setAgreed(!agreed)} className="flex items-start gap-3">
              <div className={cn(
                "w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors",
                agreed ? "bg-[#009966] border-[#009966]" : "border-gray-300"
              )}>
                {agreed && <CheckCircle2 className="w-3 h-3 text-white" />}
              </div>
              <p className="text-xs text-gray-600 text-left leading-relaxed">
                I confirm this information is accurate and I understand this
                acknowledgement is for record-keeping only and does not constitute legal advice.
              </p>
            </button>
          </div>
        </SectionCard>

        {/* Legal disclaimer */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex gap-2">
          <Info className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-gray-500 leading-relaxed">
            <strong>CollectBoss helps organise records and payment arrangements.
            It does not provide legal advice.</strong> Consult a qualified lawyer
            before using this in legal proceedings.
          </p>
        </div>

        <PrimaryButton
          fullWidth size="lg" disabled={!canSign || saving}
          icon={saving
            ? <InlineSpinner className="text-white" />
            : <FileText className="w-4 h-4" />
          }
          onClick={handleSign}
        >
          {saving ? "Saving…" : "Confirm & Save Acknowledgement"}
        </PrimaryButton>
      </div>
    </div>
  );
}
