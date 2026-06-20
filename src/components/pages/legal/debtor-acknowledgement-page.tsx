"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { PrimaryButton } from "@/components/ui/primary-button";
import { InlineSpinner } from "@/components/ui/loading-spinner";
import {
  type PaymentPlanRow,
  type PaymentLockMode,
} from "@/lib/supabase/types";
import {
  confirmPlanClient,
  formatDate,
  getNextDueDate,
  getPublicPlanClient,
} from "@/lib/db/payment-plans-client";
import { appendAuditLogClient } from "@/lib/db/audit-logs-client";
import { formatRM } from "@/lib/mock-data";
import {
  ShieldCheck, CheckCircle2, Clock, AlertCircle,
  PenLine, FileText, Info, Calendar,
} from "lucide-react";

// ─── Public-safe case info (same as debtor payment page) ─────────────────────

export interface AckCaseInfo {
  id:                string;
  debtor_name:       string;
  debtor_company:    string | null;
  balance:           number;
  amount_owed:       number;
  due_date:          string;
  invoice_no:        string | null;
  payment_lock_mode: PaymentLockMode;
}

// ─── Page states ──────────────────────────────────────────────────────────────

type PageState = "loading" | "no_plan" | "confirming" | "confirmed";

// ─── Main ─────────────────────────────────────────────────────────────────────

interface Props {
  caseInfo: AckCaseInfo;
  initialPlan?: PaymentPlanRow | null;
}

export function DebtorAcknowledgementPage({ caseInfo: c, initialPlan }: Props) {
  const [plan,       setPlan]       = useState<PaymentPlanRow | null>(initialPlan ?? null);
  const [pageState,  setPageState]  = useState<PageState>(
    initialPlan
      ? initialPlan.debtor_confirmed ? "confirmed" : "confirming"
      : "loading"
  );
  const debtorName = c.debtor_name;
  const [debtorPhone, setDebtorPhone] = useState("");
  const [agreed,      setAgreed]      = useState(false);
  const [sigText,     setSigText]     = useState("");
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  useEffect(() => {
    if (initialPlan !== undefined) return;
    getPublicPlanClient(c.id).then((p) => {
      if (p) {
        setPlan(p);
        setPageState(p.debtor_confirmed ? "confirmed" : "confirming");
      } else {
        setPageState("no_plan");
      }
    });
  }, [c.id, initialPlan]);

  async function handleConfirm() {
    if (!plan) return;
    if (!sigText.trim()) { setError("Please type your full name as signature."); return; }
    if (!agreed) { setError("Please tick the agreement checkbox."); return; }

    setSubmitting(true);
    setError(null);

    const result = await confirmPlanClient(plan.id, debtorName || sigText.trim(), debtorPhone);

    if (result.error) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    setPlan(result.data!);
    await appendAuditLogClient({
      business_id: "mock-business-id", // debtor has no businessId
      case_id:     c.id,
      action:      "payment_plan.debtor_confirmed",
      actor_type:  "debtor",
      metadata:    { plan_id: plan.id, debtor_name: sigText.trim() },
    });

    setPageState("confirmed");
    setSubmitting(false);
  }

  // Loading
  if (pageState === "loading") {
    return (
      <div className="min-h-screen bg-white flex flex-col">
        <AckHeader />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-5 h-5 border-2 border-[#009966] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-500">Loading…</p>
          </div>
        </div>
      </div>
    );
  }

  // No active plan
  if (pageState === "no_plan") {
    return (
      <div className="min-h-screen bg-white flex flex-col">
        <AckHeader />
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center gap-4">
          <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center">
            <Clock className="w-8 h-8 text-amber-400" />
          </div>
          <h2 className="text-lg font-black text-[#0D1B3D]">No Active Plan</h2>
          <p className="text-sm text-gray-500 max-w-xs leading-relaxed">
            No active payment plan has been set up for this case yet.
            Please contact the creditor for details.
          </p>
        </div>
      </div>
    );
  }

  // Already confirmed
  if (pageState === "confirmed" && plan) {
    return (
      <div className="min-h-screen bg-white flex flex-col">
        <AckHeader />
        <div className="px-5 py-6 flex flex-col gap-5">
          <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-4">
            <CheckCircle2 className="w-6 h-6 text-[#009966] shrink-0" />
            <div>
              <p className="text-sm font-bold text-emerald-800">Acknowledgement Confirmed</p>
              <p className="text-[11px] text-emerald-700 mt-0.5">
                {plan.confirmed_at
                  ? new Date(plan.confirmed_at).toLocaleString("en-MY")
                  : "Just now"}
              </p>
            </div>
          </div>

          <CaseSummaryCard c={c} />
          <PlanScheduleCard plan={plan} />
          <PaymentRefCard caseId={c.id} />

          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex gap-2">
            <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-blue-700 leading-relaxed">
              Payment details may require creditor approval before display.
              Please contact the creditor to arrange payment.
            </p>
          </div>

          <Disclaimer />
        </div>
      </div>
    );
  }

  // Confirmation form
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <AckHeader />
      <div className="px-5 py-6 flex flex-col gap-5 pb-10">
        <div>
          <h1 className="text-xl font-black text-[#0D1B3D]">Payment Plan Agreement</h1>
          <p className="text-sm text-gray-500 mt-1 leading-relaxed">
            Please review and confirm the instalment schedule below.
          </p>
        </div>

        <CaseSummaryCard c={c} />

        {/* Agreement document */}
        {plan && (
          <div className="bg-[#F2F4F7] rounded-2xl p-4 border border-gray-200">
            <div className="text-center mb-4 pb-3 border-b border-gray-200">
              <p className="text-sm font-black text-[#0D1B3D]">DEBT PAYMENT PLAN</p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                CollectBoss · {new Date().toLocaleDateString("en-MY")}
              </p>
            </div>

            <p className="text-xs text-gray-700 leading-relaxed mb-3">
              I, <strong>{c.debtor_company ?? c.debtor_name}</strong>, acknowledge
              the outstanding amount and agree to settle it according to the schedule below.
            </p>

            <div className="bg-white rounded-xl p-3 mb-3 border border-gray-100">
              {[
                { label: "Case Reference",   value: c.id },
                ...(c.invoice_no ? [{ label: "Invoice No.", value: c.invoice_no }] : []),
                { label: "Total Amount",     value: formatRM(plan.total_amount) },
                { label: "Instalments",      value: `${plan.installment_count} × ${formatRM(plan.installment_amount)}` },
                { label: "First Due",        value: formatDate(plan.due_dates[0] ?? plan.start_date) },
              ].map((row) => (
                <div key={row.label} className="flex justify-between items-center border-b border-gray-50 py-1.5 last:border-0 last:pb-0">
                  <span className="text-[11px] text-gray-400">{row.label}</span>
                  <span className="text-xs font-bold text-gray-800">{row.value}</span>
                </div>
              ))}
            </div>

            <PlanScheduleCard plan={plan} compact />
          </div>
        )}

        {/* Signature section */}
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-sm font-bold text-gray-700 mb-1.5 block">Your Full Name *</label>
            <div className="relative">
              <PenLine className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Type your full name as digital signature"
                value={sigText}
                onChange={(e) => setSigText(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-bold text-gray-700 mb-1.5 block">Phone Number (Optional)</label>
            <input
              type="tel"
              placeholder="+60 12-345 6789"
              value={debtorPhone}
              onChange={(e) => setDebtorPhone(e.target.value)}
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300"
            />
          </div>

          {/* Signature placeholder */}
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1.5">Digital Signature</p>
            <div className="w-full h-20 bg-[#F2F4F7] rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center">
              {sigText ? (
                <p className="text-lg font-bold text-gray-700 italic px-4">{sigText}</p>
              ) : (
                <div className="flex items-center gap-2 text-gray-400">
                  <PenLine className="w-4 h-4" />
                  <span className="text-xs">Your name will appear here</span>
                </div>
              )}
            </div>
            <p className="text-[10px] text-gray-400 mt-1">
              Typed name acts as digital signature placeholder.
            </p>
          </div>

          {/* Agreement checkbox */}
          <button onClick={() => setAgreed(!agreed)} className="flex items-start gap-3 text-left">
            <div className={cn(
              "w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors",
              agreed ? "bg-[#009966] border-[#009966]" : "border-gray-300"
            )}>
              {agreed && <CheckCircle2 className="w-3 h-3 text-white" />}
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              I acknowledge this outstanding amount and agree to the payment schedule above.
              I understand this is for record-keeping purposes only.
            </p>
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
            <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        <Disclaimer />

        <PrimaryButton
          fullWidth size="lg" onClick={handleConfirm}
          disabled={submitting || !agreed || !sigText.trim()}
          icon={submitting ? <InlineSpinner className="text-white" /> : <FileText className="w-4 h-4" />}
        >
          {submitting ? "Confirming…" : "Confirm Agreement"}
        </PrimaryButton>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CaseSummaryCard({ c }: { c: AckCaseInfo }) {
  return (
    <div className="bg-[#F2F4F7] rounded-2xl p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-[#0D1B3D] flex items-center justify-center text-white font-bold text-sm shrink-0">
          {(c.debtor_company ?? c.debtor_name).slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900 truncate">
            {c.debtor_company ?? c.debtor_name}
          </p>
          <p className="text-[11px] text-gray-400">Ref: {c.id}</p>
        </div>
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-gray-200">
        <p className="text-xs text-gray-500">Outstanding Amount</p>
        <p className="text-xl font-black text-[#0D1B3D]">{formatRM(c.balance > 0 ? c.balance : c.amount_owed)}</p>
      </div>
    </div>
  );
}

function PlanScheduleCard({ plan, compact }: { plan: PaymentPlanRow; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1.5", compact && "mt-1")}>
      <p className="text-xs font-bold text-gray-600">{compact ? "Schedule" : "Instalment Schedule"}</p>
      <div className="flex flex-col gap-1">
        {plan.due_dates.map((d, i) => (
          <div key={d} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
            <div className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-gray-400" />
              <p className="text-xs text-gray-700">{formatDate(d)}</p>
              {i === 0 && <span className="text-[9px] font-bold text-[#009966] bg-emerald-50 px-1.5 py-0.5 rounded-full">First</span>}
            </div>
            <p className="text-xs font-bold text-gray-900">{formatRM(plan.installment_amount)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PaymentRefCard({ caseId }: { caseId: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">
        Payment Reference
      </p>
      <div className="bg-[#F2F4F7] rounded-2xl px-4 py-3">
        <p className="text-xl font-black text-[#0D1B3D] font-mono">{caseId}</p>
      </div>
      <p className="text-[11px] text-red-500 mt-1.5 font-medium">
        ⚠️ Include this reference in all payments.
      </p>
      <p className="text-[11px] text-amber-600 mt-1">
        Payment details will be provided after creditor approval.
      </p>
    </div>
  );
}

function Disclaimer() {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex gap-2">
      <Info className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
      <p className="text-[11px] text-gray-500 leading-relaxed">
        <strong>CollectBoss helps organise records and payment arrangements.
        It does not provide legal advice.</strong> Consult a qualified lawyer
        before using this in legal proceedings.
      </p>
    </div>
  );
}

function AckHeader() {
  return (
    <header className="px-5 py-4 border-b border-gray-100">
      <span className="text-xl font-black text-[#0D1B3D]">
        Collect<span className="text-[#009966]">Boss</span>
      </span>
    </header>
  );
}
