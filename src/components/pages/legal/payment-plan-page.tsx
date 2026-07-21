"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SectionCard } from "@/components/ui/section-card";
import { LoadingSpinner, InlineSpinner } from "@/components/ui/loading-spinner";
import { useCase } from "@/hooks/use-case";
import { usePaymentPlans } from "@/hooks/use-payment-plans";
import {
  createPaymentPlanProposalClient,
  formatDate,
  getNextDueDate,
} from "@/lib/db/payment-plans-client";
import { type PaymentPlanRow } from "@/lib/supabase/types";
import { buildInstallmentPreview, minorToMyrNumber, type PaymentPlanFrequency } from "@/lib/payment-plans/schedule";
import { formatRM } from "@/lib/mock-data";
import {
  ChevronLeft, DollarSign,
  CheckCircle2, AlertCircle, Info, Copy, Check,
  ClipboardList, ExternalLink,
} from "lucide-react";

interface Props {
  caseId: string;
}

export function PaymentPlanPage({ caseId }: Props) {
  const { caseData, loading: caseLoading } = useCase(caseId);
  const { activePlan, addPlan }                                = usePaymentPlans(caseId);

  const [count,      setCount]      = useState(3);
  const [frequency,  setFrequency]  = useState<PaymentPlanFrequency>("monthly");
  const [startDate,  setStartDate]  = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split("T")[0];
  });
  const [notes,     setNotes]     = useState("");
  const [customDueDates, setCustomDueDates] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]     = useState<string | null>(null);
  const [saved,      setSaved]     = useState<PaymentPlanRow | null>(null);

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
  const totalMinor = BigInt(c.outstanding_minor);
  const totalAmount = minorToMyrNumber(totalMinor);
  let schedule: ReturnType<typeof buildInstallmentPreview> = [];
  let scheduleError: string | null = null;
  try {
    schedule = buildInstallmentPreview({
      totalMinor,
      count,
      firstDueDate: startDate,
      frequency,
      customDueDates: customDueDates.split(","),
    });
  } catch (previewError) {
    scheduleError = previewError instanceof Error ? previewError.message : "Unable to preview this schedule.";
  }

  async function handleCreate() {
    if (count < 1 || count > 24 || !startDate || scheduleError) { setError(scheduleError ?? "Enter valid payment-plan terms."); return; }

    setSubmitting(true);
    setError(null);
    const result = await createPaymentPlanProposalClient({
      caseId: c.id,
      frequency,
      firstDueDate: startDate,
      installmentCount: count,
      customDueDates: customDueDates.split(",").map((value) => value.trim()).filter(Boolean),
      notes: notes.trim(),
    });

    if (result.error) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    const plan = result.data!;
    addPlan(plan);
    setSaved(plan);

    setSubmitting(false);
  }

  // ── Existing active plan view ──────────────────────────────────────────────
  if (activePlan && !saved) {
    return (
      <div className="flex flex-col pb-6">
        <PageHeader caseId={c.id} />
        <div className="px-4 pt-5 flex flex-col gap-5">
          <PlanSummaryCard plan={activePlan} />
          <ShareSection caseId={c.id} planId={activePlan.id} />
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
                {count} instalments proposed — first due {formatDate(schedule[0]?.dueDate ?? startDate)}
              </p>
            </div>
          </div>

          <PlanSummaryCard plan={saved} />
          <ShareSection caseId={c.id} planId={saved.id} />
          <AcknowledgementLinkCard caseId={c.id} />
          <Disclaimer />

          <div className="flex flex-col gap-2">
            <Link href={`/cases/${c.id}`}>
              <PrimaryButton fullWidth>Back to Case</PrimaryButton>
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
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
                {[1, 2, 3, 4, 6, 12].map((n) => (
                  <button
                    key={n}
                    onClick={() => setCount(n)}
                    className={cn(
                      "min-h-11 rounded-xl border-2 py-2.5 text-sm font-bold transition-all",
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
                First instalment: <strong className="text-gray-700">{schedule[0] ? formatRM(minorToMyrNumber(schedule[0].amountMinor)) : "—"}</strong>
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

            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">Payment Frequency</label>
              <select value={frequency} onChange={(event) => setFrequency(event.target.value as PaymentPlanFrequency)} className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 outline-none focus:ring-2 focus:ring-emerald-200">
                <option value="monthly">Monthly</option>
                <option value="weekly">Weekly</option>
                <option value="custom">Custom dates</option>
              </select>
            </div>

            {frequency === "custom" && (
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">Custom Due Dates</label>
                <textarea value={customDueDates} onChange={(event) => setCustomDueDates(event.target.value)} rows={2} placeholder="YYYY-MM-DD, YYYY-MM-DD, ..." className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 outline-none focus:ring-2 focus:ring-emerald-200 resize-none" />
                <p className="mt-1 text-[11px] text-gray-400">Provide {count} increasing dates; the first must match the first due date.</p>
              </div>
            )}

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
            {schedule.map((item) => (
              <div key={`${item.sequence}-${item.dueDate}`} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-[#F2F4F7] flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-gray-600">{item.sequence}</span>
                  </div>
                  <p className="text-sm text-gray-700">{formatDate(item.dueDate)}</p>
                </div>
                <p className="text-sm font-bold text-gray-900">{formatRM(minorToMyrNumber(item.amountMinor))}</p>
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
        {scheduleError && !error && <p className="text-xs text-red-600">{scheduleError}</p>}

        <Disclaimer />

        <PrimaryButton
          fullWidth size="lg" onClick={handleCreate} disabled={submitting || Boolean(scheduleError)}
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

function PlanSummaryCard({ plan: p }: { plan: PaymentPlanRow }) {
  const nextDue = getNextDueDate(p);
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
        <p className="text-sm font-bold text-gray-900">Payment Plan</p>
        <span className={cn(
          "text-[10px] font-bold px-2 py-0.5 rounded-full border",
          p.status === "active" && p.debtor_confirmed
            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
            : "bg-amber-50 text-amber-700 border-amber-200"
        )}>
          {p.status === "pending_acceptance" ? "Awaiting Confirmation" : p.status === "defaulted" ? "Defaulted" : p.debtor_confirmed ? "Debtor Confirmed" : p.status}
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

function ShareSection({ caseId, planId }: { caseId: string; planId: string }) {
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/public-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "acknowledgement", paymentPlanId: planId, expiresInHours: 168 }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || typeof payload.url !== "string") {
        setError(typeof payload.error === "string" ? payload.error : "Unable to create acknowledgement link.");
      } else {
        setUrl(payload.url);
      }
    } catch {
      setError("Unable to create acknowledgement link.");
    } finally {
      setCreating(false);
    }
  }

  function copy() {
    if (!url) return;
    navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="bg-[#F2F4F7] rounded-2xl p-4">
      <p className="text-xs font-bold text-gray-600 mb-2">Share with Debtor</p>
      <p className="text-[11px] text-gray-500 mb-3">Create a one-time, expiring link for this exact payment plan.</p>
      {!url ? <button onClick={create} disabled={creating} className="w-full rounded-xl bg-[#009966] px-3 py-2.5 text-xs font-bold text-white disabled:opacity-60">{creating ? "Creating secure link…" : "Create secure acknowledgement link"}</button> : <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2.5"><p className="text-xs font-mono text-gray-600 flex-1 truncate">{url}</p><button onClick={copy} className="text-[#009966] hover:text-emerald-700 shrink-0">{copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}</button></div>}
      {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}
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
