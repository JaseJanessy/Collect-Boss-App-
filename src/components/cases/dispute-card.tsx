"use client";

import { useState } from "react";
import { AlertTriangle, FileText, Plus } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { useRegion } from "@/contexts/region-context";
import { formatDateTime, formatMinorCurrency } from "@/lib/international/formatting";
import { minorToDecimalString } from "@/lib/financial/money";
import type {
  CaseRecoveryAmountsRow, DisputeCategory, DisputeEvidenceRow, DisputeEventRow, DisputeRow, ObligationRow,
  DisputeStatus,
} from "@/lib/supabase/types";
import { canTransitionDispute, DISPUTE_STATUS_METADATA } from "@/lib/domain/workflows";

const labels: Record<DisputeCategory, string> = {
  amount_incorrect: "Amount Incorrect", already_paid: "Already Paid",
  duplicate_invoice: "Duplicate Invoice", goods_not_received: "Goods Not Received",
  damaged_quality_issue: "Damaged / Quality Issue", service_incomplete: "Service Incomplete",
  incorrect_pricing: "Incorrect Pricing", do_not_recognise_debt: "Do Not Recognise Debt", other: "Other",
};
const activeStatuses = new Set(["submitted", "under_review", "information_requested", "partially_accepted"]);

export function DisputeCard({
  balance, currency, obligations, disputes, evidence, recovery, loading, create, transition,
}: {
  balance: number; currency: string; obligations: ObligationRow[]; disputes: DisputeRow[]; evidence: DisputeEvidenceRow[];
  recovery: CaseRecoveryAmountsRow | null; loading: boolean;
  create: (input: Record<string, unknown>) => Promise<{ error?: string }>;
  transition: (id: string, input: Record<string, unknown>) => Promise<{ error?: string }>;
}) {
  const { configuration } = useRegion();
  const minorMoney = (value: number, itemCurrency = currency) => formatMinorCurrency(value, configuration.settings, itemCurrency);
  const active = disputes.find((item) => activeStatuses.has(item.status));
  const [showCreate, setShowCreate] = useState(false);
  const [obligationId, setObligationId] = useState(obligations[0]?.id ?? "");
  const target = obligations.find((item) => item.id === obligationId);
  const [category, setCategory] = useState<DisputeCategory>("amount_incorrect");
  const [amount, setAmount] = useState(target
    ? minorToDecimalString(BigInt(target.outstanding_minor), target.currency ?? currency)
    : balance.toFixed(2));
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [response, setResponse] = useState("");
  const [resolution, setResolution] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createDispute() {
    setSaving(true); setError(null);
    const result = await create({
      obligation_id: obligationId || null, category, amount, reason, description,
      idempotency_key: crypto.randomUUID(),
    });
    if (result.error) setError(result.error);
    else setShowCreate(false);
    setSaving(false);
  }
  async function update(status: DisputeStatus) {
    if (!active) return;
    if (!canTransitionDispute(active.status, status)) {
      setError(`A dispute under ${DISPUTE_STATUS_METADATA[active.status].label.toLowerCase()} cannot move to ${DISPUTE_STATUS_METADATA[status].label.toLowerCase()}.`);
      return;
    }
    if (["accepted", "partially_accepted", "rejected"].includes(status)
      && !window.confirm(`${DISPUTE_STATUS_METADATA[status].label} this dispute? The decision and response will be recorded in case activity.`)) return;
    setSaving(true); setError(null);
    const result = await transition(active.id, {
      status, response: response || null,
      resolution_amount: status === "accepted" || status === "partially_accepted" ? resolution || undefined : undefined,
    });
    if (result.error) setError(result.error);
    else { setResponse(""); setResolution(""); }
    setSaving(false);
  }

  return <SectionCard title="Disputes">
    {loading ? <p className="mt-2 text-xs text-gray-400">Loading disputes…</p> : active ? <div className="mt-2 space-y-3">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
        <div className="flex items-start justify-between gap-2">
          <div><p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Recovery amount separated</p>
            <p className="mt-1 text-lg font-black text-[#0D1B3D]">{labels[active.category]}</p></div>
          <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-amber-800">{DISPUTE_STATUS_METADATA[active.status].label}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div><p className="text-gray-500">Disputed</p><p className="font-black text-amber-800">{minorMoney(active.disputed_amount_minor, active.currency ?? currency)}</p></div>
          <div><p className="text-gray-500">Undisputed</p><p className="font-black text-emerald-700">{minorMoney(active.undisputed_amount_minor, active.currency ?? currency)}</p></div>
        </div>
        <p className="mt-2 text-xs text-gray-700">{active.description}</p>
        {recovery && <p className="mt-2 text-[11px] font-semibold text-gray-600">
          Collectable now: {minorMoney(recovery.collectable_minor)} of {minorMoney(recovery.total_outstanding_minor)}
        </p>}
      </div>
      {evidence.filter((item) => item.dispute_id === active.id).map((item) => <div key={item.id} className="flex items-center gap-2 rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
        <FileText className="h-4 w-4 text-[#009966]" />{item.file_name}
      </div>)}
      <textarea value={response} onChange={(event) => setResponse(event.target.value)} placeholder="Creditor response or requested information"
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs" />
      <input value={resolution} onChange={(event) => setResolution(event.target.value)} inputMode="decimal"
        placeholder="Accepted amount (for partial/full acceptance)"
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs" />
      <div className="flex flex-wrap gap-2">
        {canTransitionDispute(active.status, "under_review") && <button disabled={saving} onClick={() => void update("under_review")} className="rounded-lg border px-3 py-2 text-xs font-bold">Mark Under Review</button>}
        {canTransitionDispute(active.status, "information_requested") && <button disabled={saving || !response} onClick={() => void update("information_requested")} className="rounded-lg border px-3 py-2 text-xs font-bold">Request Information</button>}
        {canTransitionDispute(active.status, "partially_accepted") && <button disabled={saving || !resolution} onClick={() => void update("partially_accepted")} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white">Partially Accept</button>}
        {canTransitionDispute(active.status, "accepted") && <button disabled={saving} onClick={() => void update("accepted")} className="rounded-lg bg-[#009966] px-3 py-2 text-xs font-bold text-white">Accept Dispute</button>}
        {canTransitionDispute(active.status, "rejected") && <button disabled={saving || !response} onClick={() => void update("rejected")} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white">Reject Dispute</button>}
      </div>
    </div> : showCreate ? <div className="mt-2 grid gap-2">
      {obligations.length > 0 && <select value={obligationId} onChange={(event) => {
        setObligationId(event.target.value);
        const selected = obligations.find((item) => item.id === event.target.value);
        if (selected) setAmount(minorToDecimalString(BigInt(selected.outstanding_minor), selected.currency ?? currency));
      }} className="rounded-lg border border-gray-200 px-3 py-2 text-xs">
        {obligations.map((item) => <option key={item.id} value={item.id}>{item.reference}</option>)}
      </select>}
      <select value={category} onChange={(event) => setCategory(event.target.value as DisputeCategory)} className="rounded-lg border border-gray-200 px-3 py-2 text-xs">
        {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="Disputed amount" className="rounded-lg border border-gray-200 px-3 py-2 text-xs" />
      <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Short reason" className="rounded-lg border border-gray-200 px-3 py-2 text-xs" />
      <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" className="rounded-lg border border-gray-200 px-3 py-2 text-xs" />
      <div className="flex gap-2"><button disabled={saving || !amount || !reason || description.length < 5} onClick={() => void createDispute()} className="rounded-lg bg-[#009966] px-3 py-2 text-xs font-bold text-white">Save Dispute</button>
        <button onClick={() => setShowCreate(false)} className="px-3 text-xs font-bold text-gray-500">Cancel</button></div>
    </div> : <div className="mt-2 rounded-xl bg-[#F2F4F7] p-4">
      <p className="text-xs text-gray-600">No active structured dispute. Original invoices remain unchanged when a dispute is submitted.</p>
      <button onClick={() => setShowCreate(true)} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#009966] px-3 py-2 text-xs font-bold text-white"><Plus className="h-3.5 w-3.5" /> Add Dispute</button>
    </div>}
    {error && <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-red-600"><AlertTriangle className="h-3.5 w-3.5" />{error}</p>}
  </SectionCard>;
}

export function DisputeTimeline({ events }: { events: DisputeEventRow[] }) {
  const { configuration } = useRegion();
  if (!events.length) return null;
  return <SectionCard title="Dispute Activity"><div className="mt-2 space-y-2">
    {events.slice(0, 30).map((event) => <div key={event.id} className="border-b border-gray-50 pb-2 last:border-0">
      <p className="text-xs font-bold capitalize text-gray-700">{event.event_type.replaceAll("_", " ")}</p>
      <p className="text-[10px] text-gray-400">{formatDateTime(event.created_at, configuration.settings)}</p>
      {event.response && <p className="mt-1 text-[11px] text-gray-600">{event.response}</p>}
    </div>)}
  </div></SectionCard>;
}
