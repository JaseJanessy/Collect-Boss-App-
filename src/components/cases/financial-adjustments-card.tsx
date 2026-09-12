"use client";

import { useState } from "react";
import { BadgeDollarSign, CheckCircle2, Clock3 } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { useRegion } from "@/contexts/region-context";
import { formatMinorCurrency } from "@/lib/international/formatting";
import type {
  CaseClosureReason,
  FinancialAdjustmentEventRow,
  FinancialAdjustmentRow,
  FinancialAdjustmentType,
  ObligationRow,
} from "@/lib/supabase/types";
import { ACTION_LABELS } from "@/lib/domain/terminology";

const typeLabels: Record<FinancialAdjustmentType, string> = {
  credit_note: "Credit Note",
  settlement_adjustment: "Settlement Adjustment",
  write_off: "Write-Off",
  manual_correction: "Manual Correction",
  returned_goods: "Returned Goods",
  commercial_discount: "Discount / Commercial Adjustment",
  other: "Other",
};
const closureLabels: Record<CaseClosureReason, string> = {
  paid_in_full: "Paid in Full", settled: "Settled", written_off: "Written Off",
  dispute_resolved: "Dispute Resolved", cancelled: "Cancelled", duplicate: "Duplicate",
  professional_handoff: "Professional Handoff", other: "Other",
};

export function FinancialAdjustmentsCard({
  caseStatus, currency, outstandingMinor, contractualDueMinor, statusVersion, obligations,
  adjustments, events, loading, canManageCase, canSettle, canReviewWriteOff, submit,
}: {
  caseStatus: string;
  currency: string;
  outstandingMinor: number;
  contractualDueMinor: number;
  statusVersion: number;
  obligations: ObligationRow[];
  adjustments: FinancialAdjustmentRow[];
  events: FinancialAdjustmentEventRow[];
  loading: boolean;
  canManageCase: boolean;
  canSettle: boolean;
  canReviewWriteOff: boolean;
  submit: (input: Record<string, unknown>) => Promise<{ error?: string }>;
}) {
  const { configuration } = useRegion();
  const money = (value: number, itemCurrency = currency) => formatMinorCurrency(value, configuration.settings, itemCurrency);
  const [mode, setMode] = useState<"idle" | "adjustment" | "settlement" | "closure">("idle");
  const [type, setType] = useState<FinancialAdjustmentType>("credit_note");
  const [direction, setDirection] = useState<"credit" | "debit">("credit");
  const [amount, setAmount] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [obligationId, setObligationId] = useState("");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [cashAmount, setCashAmount] = useState("0.00");
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [closureReason, setClosureReason] = useState<CaseClosureReason>(
    outstandingMinor === 0 ? "paid_in_full" : "cancelled",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingWriteOffs = adjustments.filter((item) =>
    item.adjustment_type === "write_off" && item.approval_status === "pending");

  async function run(input: Record<string, unknown>) {
    setSaving(true); setError(null);
    const result = await submit(input);
    if (result.error) setError(result.error);
    else { setMode("idle"); setAmount(""); setNewAmount(""); setReason(""); setReference(""); }
    setSaving(false);
  }

  function closeCase() {
    const noteRequired = ["cancelled", "duplicate", "professional_handoff", "other"].includes(closureReason);
    if (noteRequired && !reason.trim()) {
      setError("Enter a closure note explaining why recovery work is ending.");
      return;
    }
    if (!window.confirm("Close this case? Recovery work will end, the closure reason will be audited, and the case cannot be reopened from this screen.")) return;
    void run({ action: "close", reasonCode: closureReason, note: reason, expectedVersion: statusVersion });
  }

  return <SectionCard title="Credits, Adjustments & Settlement">
    <p className="mt-1 text-xs leading-relaxed text-gray-500">
      These entries change the obligation balance without being counted as recovered cash.
    </p>
    {pendingWriteOffs.map((item) => <div key={item.id} className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-amber-900">Write-off awaiting owner approval</p>
        <p className="mt-1 text-sm font-black text-[#0D1B3D]">{money(item.amount_minor, item.currency ?? currency)}</p>
        <p className="mt-1 text-xs text-amber-800">{item.reason}</p></div><Clock3 className="h-4 w-4 text-amber-600" /></div>
      {canReviewWriteOff && <div className="mt-2 flex gap-2">
        <button disabled={saving} onClick={() => void run({ action: "review_write_off", adjustmentId: item.id, decision: "approved" })}
          className="rounded-lg bg-[#009966] px-3 py-2 text-xs font-bold text-white">Approve</button>
        <button disabled={saving} onClick={() => {
          const rejection = window.prompt("Reason for rejecting this write-off:")?.trim();
          if (rejection) void run({ action: "review_write_off", adjustmentId: item.id, decision: "rejected", reason: rejection });
        }} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-600">Reject</button>
      </div>}
    </div>)}

    {mode === "idle" && caseStatus !== "closed" && (canManageCase || canSettle) && <div className="mt-3 flex flex-wrap gap-2">
      {canManageCase && <button onClick={() => setMode("adjustment")} className="rounded-lg bg-[#0D1B3D] px-3 py-2 text-xs font-bold text-white">Add Adjustment</button>}
      {canSettle && outstandingMinor > 0 && <button onClick={() => setMode("settlement")} className="rounded-lg border border-emerald-200 px-3 py-2 text-xs font-bold text-emerald-700">Record Settlement</button>}
      {canManageCase && <button onClick={() => setMode("closure")} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700">Close Case</button>}
    </div>}

    {mode === "adjustment" && <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <select value={type} onChange={(event) => {
        const next = event.target.value as FinancialAdjustmentType; setType(next);
        if (next !== "manual_correction") setDirection(next === "other" ? direction : "credit");
      }} className="rounded-lg border border-gray-200 px-3 py-2 text-xs">
        {Object.entries(typeLabels).filter(([value]) => value !== "settlement_adjustment").map(([value, label]) =>
          <option key={value} value={value}>{label}</option>)}
      </select>
      {type === "other" && <select value={direction} onChange={(event) => setDirection(event.target.value as "credit" | "debit")}
        className="rounded-lg border border-gray-200 px-3 py-2 text-xs"><option value="credit">Credit / reduce balance</option><option value="debit">Debit / increase balance</option></select>}
      {obligations.length > 0 && <select value={obligationId} onChange={(event) => setObligationId(event.target.value)}
        className="rounded-lg border border-gray-200 px-3 py-2 text-xs">
        <option value="">{obligations.length > 1 ? "Allocate automatically (credits only)" : "Linked obligation"}</option>
        {obligations.map((item) => <option key={item.id} value={item.id}>{item.reference} · {money(item.outstanding_minor, item.currency ?? currency)}</option>)}
      </select>}
      {type === "manual_correction"
        ? <input value={newAmount} onChange={(event) => setNewAmount(event.target.value)} inputMode="decimal" placeholder={`New contractual amount (current ${money(contractualDueMinor)})`} className="rounded-lg border border-gray-200 px-3 py-2 text-xs" />
        : <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="Adjustment amount" className="rounded-lg border border-gray-200 px-3 py-2 text-xs" />}
      <input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Credit note / approval reference" className="rounded-lg border border-gray-200 px-3 py-2 text-xs" />
      <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required reason" className="rounded-lg border border-gray-200 px-3 py-2 text-xs sm:col-span-2" />
      <button disabled={saving || !reason || (type === "manual_correction" ? !newAmount : !amount)}
        onClick={() => void run({ action: "adjustment", adjustmentType: type, direction, amount, newAmount, obligationId, reason, reference, idempotencyKey: crypto.randomUUID() })}
        className="rounded-lg bg-[#009966] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
        {type === "write_off" ? "Request Write-Off Approval" : "Post Adjustment"}
      </button>
      <button onClick={() => setMode("idle")} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600">Cancel</button>
    </div>}

    {mode === "settlement" && <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 sm:col-span-2">
        Outstanding: <strong>{money(outstandingMinor)}</strong>. Approved cash is recorded as payment; the remaining concession is a separate settlement adjustment.
      </p>
      <input value={cashAmount} onChange={(event) => setCashAmount(event.target.value)} inputMode="decimal" placeholder="Cash received now" className="rounded-lg border border-gray-200 px-3 py-2 text-xs" />
      <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-xs">
        <option value="bank_transfer">Bank transfer</option><option value="duitnow_qr">DuitNow QR</option>
        <option value="cash">Cash</option><option value="cheque">Cheque</option><option value="tng_ewallet">TNG eWallet</option>
      </select>
      <input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Settlement reference" className="rounded-lg border border-gray-200 px-3 py-2 text-xs" />
      <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required settlement reason" className="rounded-lg border border-gray-200 px-3 py-2 text-xs" />
      <button disabled={saving || !reason} onClick={() => void run({ action: "settlement", cashAmount, paymentMethod, reference, reason, idempotencyKey: crypto.randomUUID() })}
        className="rounded-lg bg-[#009966] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{ACTION_LABELS.recordSettlement}</button>
      <button onClick={() => setMode("idle")} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600">Cancel</button>
    </div>}

    {mode === "closure" && <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <select value={closureReason} onChange={(event) => setClosureReason(event.target.value as CaseClosureReason)}
        className="rounded-lg border border-gray-200 px-3 py-2 text-xs">
        {Object.entries(closureLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Closure note" className="rounded-lg border border-gray-200 px-3 py-2 text-xs" />
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:col-span-2">Closing ends recovery work and records the selected reason in the audit history. It does not delete case data.</p>
      <button disabled={saving} onClick={closeCase}
        className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{ACTION_LABELS.closeCase}</button>
      <button onClick={() => setMode("idle")} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600">Cancel</button>
    </div>}

    {error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}
    {loading ? <p className="mt-3 text-xs text-gray-400">Loading financial history…</p> : adjustments.length > 0 && <div className="mt-4 border-t border-gray-100 pt-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Adjustment history</p>
      <div className="mt-2 space-y-2">{adjustments.map((item) => <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg bg-gray-50 p-2.5">
        <div><p className="text-xs font-bold text-gray-800">{typeLabels[item.adjustment_type]}</p>
          <p className="mt-0.5 text-[10px] text-gray-500">{item.reason}</p>
          {item.old_amount_minor !== null && <p className="mt-0.5 text-[10px] text-gray-500">Old {money(item.old_amount_minor, item.currency ?? currency)} → New {money(item.new_amount_minor ?? 0, item.currency ?? currency)}</p>}
          <p className="mt-0.5 text-[10px] text-gray-400">{events.filter((event) => event.adjustment_id === item.id).map((event) => event.event_type).join(" · ")}</p></div>
        <div className="text-right"><p className={`text-xs font-black ${item.direction === "credit" ? "text-emerald-700" : "text-red-700"}`}>{item.direction === "credit" ? "−" : "+"}{money(item.amount_minor, item.currency ?? currency)}</p>
          <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold capitalize text-gray-500">{item.approval_status === "approved" && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}{item.approval_status}</span></div>
      </div>)}</div>
    </div>}
    <div className="mt-3 flex items-start gap-2 rounded-lg bg-blue-50 p-2.5 text-[10px] text-blue-700">
      <BadgeDollarSign className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Write-offs require a separately authorised approval before they affect the case balance.
    </div>
  </SectionCard>;
}
