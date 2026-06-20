"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SectionCard } from "@/components/ui/section-card";
import { LoadingSpinner, InlineSpinner } from "@/components/ui/loading-spinner";
import { useCase } from "@/hooks/use-case";
import { usePaymentPlans } from "@/hooks/use-payment-plans";
import { useBusinessId } from "@/hooks/use-business-id";
import {
  createPaymentPlanClient,
  calculateDueDates,
  calculateInstallment,
  formatDate,
  getNextDueDate,
} from "@/lib/db/payment-plans-client";
import { updateNextActionClient } from "@/lib/db/cases-client";
import { appendAuditLogClient } from "@/lib/db/audit-logs-client";
import { type PaymentPlanRow } from "@/lib/supabase/types";
import { formatRM } from "@/lib/mock-data";
import {
  ChevronLeft, Calendar, DollarSign, Hash,
  CheckCircle2, AlertCircle, Info, Copy, Check,
  ClipboardList, ExternalLink,
} from "lucide-react";

interface Props {
  caseId: string;
}

export function PaymentPlanPage({ caseId }: Props) {
  const { caseData, loading: caseLoading, update: updateCase } = useCase(caseId);
  const { activePlan, addPlan }                                = usePaymentPlans(caseId);
  const businessId = useBusinessId();

  const [count,      setCount]      = useState(3);
  const [startDate,  setStartDate]  = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split("T")[0];
  });
  const [notes,     setNotes]     = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]     = useState<string | null>(null);
  const [saved,      setSaved]     = useState<PaymentPlanRow | null>(null);
  const [copied,     setCopied]    = useState(false);

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

  const c = caseData;
  const totalAmount   = c.balance > 0 ? c.balance : c.amount_owed;
  const installAmount = calculateInstallment(totalAmount, count);
  const dueDates      = calculateDueDates(startDate, count);

  async function handleCreate() {
    if (count < 1 || count > 24) { setError("Installment count must be between 1 and 24."); return; }
    if (!startDate) { setError("Start date is required."); return; }

    setSubmitting(true);
    setError(null);
    const bId = businessId ?? "mock-business-id";

    const result = await createPaymentPlanClient({
      case_id:            c.id,
      total_amount:       totalAmount,
      installment_count:  count,
      installment_amount: installAmount,
      start_date:         startDate,
      due_dates:          dueDates,
      status:             "active",
      debtor_confirmed:   false,
      debtor_name:        null,
      debtor_phone:       c.debtor_phone,
      signature_url:      null,
      confirmed_at:       null,
      notes:              notes.trim() || null,
    });

    if (result.error) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    const plan = result.data!;
    addPlan(plan);
    setSaved(plan);

    // Update case next_best_action
    const actionResult = await updateNextActionClient(
      c.id,
      `Payment plan active: ${count} instalment(s) of ${formatRM(installAmount)}. Next due: ${formatDate(dueDates[0])}`
    );
    if (actionResult.data) updateCase(actionResult.data);

    // Audit log
    await appendAuditLogClient({
      business_id: bId,
      case_id:     c.id,
      action:      "payment_plan.created",
      actor_type:  "owner",
      metadata: {
        plan_id:           plan.id,
        total_amount:      totalAmount,
        installment_count: count,
        installment_amount: installAmount,
      },
    });

    setSubmitting(false);
  }

  function copyAckLink() {
    const url = `${window.location.origin}/acknowledge/${c.id}`;
    navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const ackUrl = `/acknowledge/${c.id}`;

  // ── Existing active plan view ──────────────────────────────────────────────
  if (activePlan && !saved) {
    return (
      <div className="flex flex-col pb-6">
        <PageHeader caseId={c.id} />
        <div className="px-4 pt-5 flex flex-col gap-5">
          <PlanSummaryCard plan={activePlan} caseId={c.id} />
          <ShareSection caseId={c.id} />
          <AcknowledgementLinkCard caseId={c.id} />
          <Disclaimer />
        </div>
      </div>
    );
  }

  // ── Success after creating ─────────────────────────────────────────────────
  if (saved) {
    return (
      <div className="flex flex-col pb-6">
        <PageHeader caseId={c.id} />
        <div className="px-4 pt-5 flex flex-col gap-5">
          <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-4">
            <CheckCircle2 className="w-6 h-6 text-[#009966] shrink-0" />
            <div>
              <p className="text-sm font-bold text-emerald-800">Payment Plan Created!</p>
              <p className="text-[11px] text-emerald-700 mt-0.5">
                {count} instalments of {formatRM(installAmount)} — starting {formatDate(dueDates[0])}
              </p>
            </div>
          </div>

          <PlanSummaryCard plan={saved} caseId={c.id} />
          <ShareSection caseId={c.id} />
          <AcknowledgementLinkCard caseId={c.id} />
          <Disclaimer />

          <div className="flex flex-col gap-2">
            <Link href={`/cases/${c.id}`}>
              <PrimaryButton fullWidth>Back to Case</PrimaryButton>
            </Link>
            <Link href={ackUrl}>
              <PrimaryButton fullWidth variant="ghost" icon={<ExternalLink className="w-4 h-4" />}>
                Preview Debtor Acknowledgement
              </PrimaryButton>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Create plan form ───────────────────────────────────────────────────────
  return (
    <div className="flex flex-col pb-6">
      <PageHeader caseId={c.id} />
      <div className="px-4 pt-5 flex flex-col gap-5">
        {/* Case summary */}
        <div className="bg-[#0D1B3D] rounded-2xl p-4 flex items-center justify-between">
          <div>
            <p className="text-blue-200 text-xs font-semibold truncate max-w-[180px]">{c.debtor_name}</p>
            <p className="text-[11px] text-blue-300 font-mono">{c.id}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-blue-200">Balance Due</p>
            <p className="text-xl font-black text-white">{formatRM(totalAmount)}</p>
          </div>
        </div>

        {/* Plan configuration */}
        <SectionCard title="Plan Configuration">
          <div className="flex flex-col gap-4 mt-3">
            {/* Total (read-only) */}
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">Total Amount to Settle (RM)</label>
              <div className="flex items-center gap-2 bg-[#F2F4F7] rounded-xl px-4 py-3">
                <DollarSign className="w-4 h-4 text-gray-400" />
                <p className="text-base font-black text-[#0D1B3D]">{formatRM(totalAmount)}</p>
              </div>
            </div>

            {/* Installment count */}
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">
                Number of Instalments
              </label>
              <div className="grid grid-cols-6 gap-1.5">
                {[1, 2, 3, 4, 6, 12].map((n) => (
                  <button
                    key={n}
                    onClick={() => setCount(n)}
                    className={cn(
                      "py-2.5 rounded-xl text-sm font-bold border-2 transition-all",
                      count === n
                        ? "border-[#009966] bg-emerald-50 text-[#009966]"
                        : "border-gray-100 bg-white text-gray-500 hover:border-gray-200"
                    )}
                  >
                    {n}×
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                Each instalment: <strong className="text-gray-700">{formatRM(installAmount)}</strong>
              </p>
            </div>

            {/* Start date */}
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">
                First Instalment Due
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 outline-none focus:ring-2 focus:ring-emerald-200"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">
                Notes <span className="text-gray-400 font-normal">(Optional)</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Any additional terms or notes for the debtor…"
                className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 outline-none focus:ring-2 focus:ring-emerald-200 resize-none"
              />
            </div>
          </div>
        </SectionCard>

        {/* Due dates preview */}
        <SectionCard title="Instalment Schedule Preview">
          <div className="flex flex-col gap-2 mt-2">
            {dueDates.map((d, i) => (
              <div key={d} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-[#F2F4F7] flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-gray-600">{i + 1}</span>
                  </div>
                  <p className="text-sm text-gray-700">{formatDate(d)}</p>
                </div>
                <p className="text-sm font-bold text-gray-900">{formatRM(installAmount)}</p>
              </div>
            ))}
            <div className="flex items-center justify-between pt-1.5 border-t border-gray-200">
              <p className="text-xs font-bold text-gray-500">Total</p>
              <p className="text-sm font-black text-[#0D1B3D]">{formatRM(totalAmount)}</p>
            </div>
          </div>
        </SectionCard>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
            <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        <Disclaimer />

        <PrimaryButton
          fullWidth size="lg" onClick={handleCreate} disabled={submitting}
          icon={submitting ? <InlineSpinner className="text-white" /> : <ClipboardList className="w-4 h-4" />}
        >
          {submitting ? "Creating Plan…" : "Create Payment Plan"}
        </PrimaryButton>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PageHeader({ caseId }: { caseId: string }) {
  return (
    <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
      <div className="flex items-center gap-2 mb-1">
        <Link href={`/cases/${caseId}`} className="text-gray-400 hover:text-gray-600">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-lg font-bold text-[#0D1B3D]">Payment Plan</h1>
      </div>
      <p className="text-xs text-gray-400 ml-7">Arrange a structured instalment schedule.</p>
    </div>
  );
}

function PlanSummaryCard({ plan: p, caseId }: { plan: PaymentPlanRow; caseId: string }) {
  const nextDue = getNextDueDate(p);
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
        <p className="text-sm font-bold text-gray-900">Active Payment Plan</p>
        <span className={cn(
          "text-[10px] font-bold px-2 py-0.5 rounded-full border",
          p.debtor_confirmed
            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
            : "bg-amber-50 text-amber-700 border-amber-200"
        )}>
          {p.debtor_confirmed ? "Debtor Confirmed" : "Awaiting Confirmation"}
        </span>
      </div>
      <div className="px-4 py-3 flex flex-col gap-2.5">
        {[
          { label: "Total Amount",    value: formatRM(p.total_amount) },
          { label: "Instalments",     value: `${p.installment_count}× ${formatRM(p.installment_amount)}` },
          { label: "First Due",       value: formatDate(p.due_dates[0] ?? p.start_date) },
          { label: "Next Due",        value: nextDue ? formatDate(nextDue) : "Completed" },
        ].map((row) => (
          <div key={row.label} className="flex items-center justify-between">
            <span className="text-xs text-gray-400">{row.label}</span>
            <span className="text-sm font-bold text-gray-800">{row.value}</span>
          </div>
        ))}
        {p.notes && (
          <p className="text-[11px] text-gray-500 italic pt-1 border-t border-gray-50">&ldquo;{p.notes}&rdquo;</p>
        )}
      </div>
    </div>
  );
}

function ShareSection({ caseId }: { caseId: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined"
    ? `${window.location.origin}/acknowledge/${caseId}`
    : `/acknowledge/${caseId}`;

  function copy() {
    navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="bg-[#F2F4F7] rounded-2xl p-4">
      <p className="text-xs font-bold text-gray-600 mb-2">Share with Debtor</p>
      <p className="text-[11px] text-gray-500 mb-3">
        Send this link to the debtor so they can view and confirm the plan.
      </p>
      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2.5">
        <p className="text-xs font-mono text-gray-600 flex-1 truncate">{url}</p>
        <button onClick={copy} className="text-[#009966] hover:text-emerald-700 shrink-0">
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

function AcknowledgementLinkCard({ caseId }: { caseId: string }) {
  return (
    <Link
      href={`/legal/${caseId}/acknowledge`}
      className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3.5 hover:border-[#009966] hover:bg-emerald-50 transition-all"
    >
      <ClipboardList className="w-4 h-4 text-[#009966]" />
      <div className="flex-1">
        <p className="text-sm font-bold text-gray-800">Debt Acknowledgement Document</p>
        <p className="text-[11px] text-gray-400">Sign and save creditor confirmation</p>
      </div>
      <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
    </Link>
  );
}

function Disclaimer() {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex gap-2">
      <Info className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
      <p className="text-[11px] text-gray-500 leading-relaxed">
        <strong>CollectBoss helps organise records and payment arrangements. It does not
        provide legal advice.</strong> Consult a qualified lawyer before using this
        in legal proceedings.
      </p>
    </div>
  );
}
