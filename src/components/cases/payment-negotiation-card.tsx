"use client";

import { useState } from "react";
import { HandCoins } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { formatRM } from "@/lib/mock-data";
import type {
  PaymentNegotiationEventRow,
  PaymentNegotiationRevisionRow,
  PaymentNegotiationRow,
} from "@/lib/supabase/types";

const optionLabels = {
  promise_to_pay: "Promise to Pay",
  installment_plan: "Instalment Plan",
  payment_difficulty: "Payment Difficulty",
};

export function PaymentNegotiationCard({
  negotiations, revisions, loading, transition,
}: {
  negotiations: PaymentNegotiationRow[];
  revisions: PaymentNegotiationRevisionRow[];
  loading: boolean;
  transition: (input: Record<string, unknown>) => Promise<{ error?: string }>;
}) {
  const active = negotiations.find((item) => item.status === "proposed" || item.status === "countered");
  const revision = active ? revisions.find((item) =>
    item.negotiation_id === active.id && item.revision_no === active.current_revision_no) : null;
  const [countering, setCountering] = useState(false);
  const [amountNow, setAmountNow] = useState("0.00");
  const [installmentAmount, setInstallmentAmount] = useState("");
  const [frequency, setFrequency] = useState<"weekly" | "monthly">("monthly");
  const [startDate, setStartDate] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "accepted" | "declined" | "countered") {
    if (!active) return;
    let reason = "";
    if (action === "declined") {
      reason = window.prompt("Reason for declining this proposal:")?.trim() ?? "";
      if (!reason) return;
    }
    setSaving(true); setError(null);
    const result = await transition({
      negotiationId: active.id, negotiationAction: action, reason,
      ...(action === "countered" ? { amountNow, installmentAmount, frequency, startDate, note } : {}),
    });
    if (result.error) setError(result.error);
    else setCountering(false);
    setSaving(false);
  }

  if (loading) return <SectionCard title="Payment Arrangement"><p className="mt-2 text-xs text-gray-400">Loading arrangement…</p></SectionCard>;
  if (!active || !revision) return null;
  return <SectionCard title="Payment Arrangement">
    <div className="mt-2 rounded-xl border border-amber-100 bg-amber-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Customer proposal</p>
          <p className="mt-1 text-sm font-bold text-[#0D1B3D]">{optionLabels[active.option_type]}</p></div>
        <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold capitalize text-amber-700">{active.status}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <p><span className="text-gray-500">Amount now</span><br/><strong>{formatRM(Number(revision.amount_now_minor) / 100)}</strong></p>
        <p><span className="text-gray-500">Instalment</span><br/><strong>{formatRM(Number(revision.installment_amount_minor) / 100)} {revision.frequency}</strong></p>
        <p><span className="text-gray-500">Start date</span><br/><strong>{revision.start_date}</strong></p>
        <p><span className="text-gray-500">Revision</span><br/><strong>#{revision.revision_no} · {revision.proposed_by}</strong></p>
      </div>
      {revision.reason && <p className="mt-2 text-xs text-gray-600">Reason: {revision.reason}</p>}
      {revision.note && <p className="mt-1 text-xs text-gray-600">Note: {revision.note}</p>}
    </div>
    {countering ? <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <input value={amountNow} onChange={(event) => setAmountNow(event.target.value)} inputMode="decimal" placeholder="Amount now" className="rounded-lg border border-gray-200 px-3 py-2 text-xs" />
      <input value={installmentAmount} onChange={(event) => setInstallmentAmount(event.target.value)} inputMode="decimal" placeholder="Instalment amount" className="rounded-lg border border-gray-200 px-3 py-2 text-xs" />
      <select value={frequency} onChange={(event) => setFrequency(event.target.value as "weekly" | "monthly")} className="rounded-lg border border-gray-200 px-3 py-2 text-xs"><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select>
      <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-xs" />
      <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Counter-proposal note" className="rounded-lg border border-gray-200 px-3 py-2 text-xs sm:col-span-2" />
      <button disabled={saving || !installmentAmount || !startDate} onClick={() => void act("countered")} className="rounded-lg bg-[#009966] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Send Counter</button>
      <button onClick={() => setCountering(false)} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600">Cancel</button>
    </div> : <div className="mt-3 flex flex-wrap gap-2">
      <button disabled={saving} onClick={() => void act("accepted")} className="rounded-lg bg-[#009966] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Accept Terms</button>
      <button disabled={saving} onClick={() => setCountering(true)} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700">Counter</button>
      <button disabled={saving} onClick={() => void act("declined")} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-600">Decline</button>
    </div>}
    {error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}
  </SectionCard>;
}

export function PaymentNegotiationTimeline({ events }: { events: PaymentNegotiationEventRow[] }) {
  if (!events.length) return null;
  return <SectionCard title="Payment Arrangement Activity"><ol className="mt-2 space-y-2">
    {events.slice(0, 30).map((event) => <li key={event.id} className="flex gap-2 border-b border-gray-50 pb-2 last:border-0">
      <HandCoins className="mt-0.5 h-4 w-4 text-amber-500" />
      <div><p className="text-xs font-bold capitalize text-gray-700">{event.event_type}</p>
        <p className="text-[10px] text-gray-400">{new Date(event.created_at).toLocaleString()}</p>
        {event.note && <p className="mt-0.5 text-[11px] text-gray-500">{event.note}</p>}</div>
    </li>)}
  </ol></SectionCard>;
}
