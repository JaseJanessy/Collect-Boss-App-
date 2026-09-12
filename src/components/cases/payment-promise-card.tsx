"use client";

import { useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Link2, Plus, XCircle } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { useRegion } from "@/contexts/region-context";
import { formatCalendarDate, formatCurrency, formatDateTime, formatMinorCurrency } from "@/lib/international/formatting";
import type {
  PaymentPromiseAllocationRow,
  PaymentPromiseEventRow,
  PaymentPromiseRow,
  PaymentPromiseSource,
  PaymentRow,
} from "@/lib/supabase/types";
import { ACTION_LABELS } from "@/lib/domain/terminology";
import { canTransitionPromise, PROMISE_STATUS_METADATA } from "@/lib/domain/workflows";

const sourceLabels: Record<PaymentPromiseSource, string> = {
  whatsapp: "WhatsApp", call: "Call", email: "Email", portal: "Portal",
  in_person: "In Person", manual: "Manual",
};
export function PaymentPromiseCard({
  balance, currency, legacyDueDate, promises, payments, allocations, loading, requestCreate, requestUpdate,
}: {
  balance: number;
  currency: string;
  legacyDueDate: string | null;
  promises: PaymentPromiseRow[];
  payments: PaymentRow[];
  allocations: PaymentPromiseAllocationRow[];
  loading: boolean;
  requestCreate: (input: {
    amount: string; promise_date: string; source: PaymentPromiseSource;
    source_activity_type?: string; note?: string; idempotency_key: string;
  }) => Promise<{ error?: string }>;
  requestUpdate: (promiseId: string, input: Record<string, unknown>) => Promise<{ error?: string }>;
}) {
  const { configuration } = useRegion();
  const money = (value: number, itemCurrency = currency) => formatCurrency(value, configuration.settings, itemCurrency);
  const minorMoney = (value: number, itemCurrency = currency) => formatMinorCurrency(value, configuration.settings, itemCurrency);
  const active = promises.find((promise) => ["pending", "partially_fulfilled", "missed"].includes(promise.status));
  const allocatedPayments = new Set(allocations.map((allocation) => allocation.payment_id));
  const eligiblePayments = payments.filter((payment) => !allocatedPayments.has(payment.id));
  const [creating, setCreating] = useState(false);
  const [amount, setAmount] = useState(balance.toFixed(2));
  const [date, setDate] = useState("");
  const [source, setSource] = useState<PaymentPromiseSource>("call");
  const [activity, setActivity] = useState("");
  const [note, setNote] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const progress = active ? Math.min(100, Math.round(active.amount_fulfilled_minor / active.promised_amount_minor * 100)) : 0;

  async function createPromise() {
    setSaving(true); setError(null);
    const result = await requestCreate({
      amount, promise_date: date, source, source_activity_type: activity || undefined,
      note: note || undefined, idempotency_key: crypto.randomUUID(),
    });
    if (result.error) setError(result.error);
    else { setCreating(false); setActivity(""); setNote(""); }
    setSaving(false);
  }

  async function matchPayment() {
    if (!active || !paymentId) return;
    setSaving(true); setError(null);
    const result = await requestUpdate(active.id, {
      action: "match_payment", payment_id: paymentId, override, reason: override ? reason : undefined,
    });
    if (result.error) setError(result.error);
    else { setPaymentId(""); setOverride(false); setReason(""); }
    setSaving(false);
  }

  async function cancelPromise() {
    if (!active) return;
    if (!canTransitionPromise(active.status, "cancelled")) {
      setError(`A ${PROMISE_STATUS_METADATA[active.status].label.toLowerCase()} promise cannot be cancelled.`);
      return;
    }
    const cancellationReason = window.prompt("Reason for cancelling this promise:")?.trim();
    if (!cancellationReason) return;
    if (!window.confirm("Cancel this Promise to Pay? It will stop future matching and the reason will remain in the case activity.")) return;
    setSaving(true); setError(null);
    const result = await requestUpdate(active.id, { action: "cancel", reason: cancellationReason });
    if (result.error) setError(result.error);
    setSaving(false);
  }

  return (
    <SectionCard title="Promise to Pay">
      {loading ? <p className="mt-2 text-xs text-gray-400">Loading promise…</p> : active ? (
        <div className="mt-2 space-y-3">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-600">Active commitment</p>
                <p className="mt-1 text-2xl font-black text-[#0D1B3D]">{minorMoney(active.promised_amount_minor, active.currency ?? currency)}</p>
                <p className="mt-1 text-xs text-gray-600">Due {formatCalendarDate(active.promise_date, configuration.settings)} · {sourceLabels[active.source]}</p>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-emerald-700">
                {PROMISE_STATUS_METADATA[active.status].label}
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-emerald-100">
              <div className="h-full rounded-full bg-[#009966]" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-1 text-[11px] text-gray-500">
              {minorMoney(active.amount_fulfilled_minor, active.currency ?? currency)} explicitly matched · {progress}%
            </p>
            {active.note && <p className="mt-2 text-xs text-gray-600">{active.note}</p>}
          </div>

          {active.status !== "fulfilled" && active.status !== "cancelled" && (
            <div className="rounded-xl border border-gray-100 p-3">
              <p className="text-xs font-bold text-[#0D1B3D]">Match an approved payment</p>
              <p className="mt-1 text-[10px] text-gray-500">
                Only the payment selected here counts toward this promise. Other case payments remain unrelated.
              </p>
              <select value={paymentId} onChange={(event) => setPaymentId(event.target.value)}
                className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs">
                <option value="">Select payment</option>
                {eligiblePayments.map((payment) => (
                  <option key={payment.id} value={payment.id}>
                    {money(payment.amount, payment.currency ?? currency)} · {formatDateTime(payment.created_at, configuration.settings, { dateStyle: "medium", timeStyle: undefined })} · {payment.reference_no ?? payment.payment_method}
                  </option>
                ))}
              </select>
              <label className="mt-2 flex items-center gap-2 text-[11px] text-gray-600">
                <input type="checkbox" checked={override} onChange={(event) => setOverride(event.target.checked)} />
                Authorised override (for a payment outside the normal date/status rule)
              </label>
              {override && <input value={reason} onChange={(event) => setReason(event.target.value)}
                placeholder="Required override reason"
                className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs" />}
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={!paymentId || saving} onClick={() => void matchPayment()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#009966] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                  <Link2 className="h-3.5 w-3.5" /> Match Payment
                </button>
                <button type="button" disabled={saving} onClick={() => void cancelPromise()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600">
                  <XCircle className="h-3.5 w-3.5" /> Cancel Promise to Pay
                </button>
              </div>
            </div>
          )}
        </div>
      ) : creating ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-[11px] font-semibold text-gray-600">Promised amount
            <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal"
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs" />
          </label>
          <label className="text-[11px] font-semibold text-gray-600">Promise date
            <input type="date" value={date} min={new Date().toISOString().slice(0, 10)}
              onChange={(event) => setDate(event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs" />
          </label>
          <label className="text-[11px] font-semibold text-gray-600">Source
            <select value={source} onChange={(event) => setSource(event.target.value as PaymentPromiseSource)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs">
              {Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-semibold text-gray-600">Source activity
            <input value={activity} onChange={(event) => setActivity(event.target.value)}
              placeholder="Call log, message, meeting…"
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs" />
          </label>
          <label className="text-[11px] font-semibold text-gray-600 sm:col-span-2">Optional note
            <textarea value={note} onChange={(event) => setNote(event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs" />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" disabled={saving || !amount || !date} onClick={() => void createPromise()}
              className="rounded-lg bg-[#009966] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Save Promise</button>
            <button type="button" onClick={() => setCreating(false)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-2 rounded-xl bg-[#F2F4F7] p-4">
          {legacyDueDate && <p className="mb-2 text-xs text-amber-700">
            Legacy case promise due {legacyDueDate}. It remains supported but has no guessed first-class amount.
          </p>}
          <button type="button" onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#009966] px-3 py-2 text-xs font-bold text-white">
            <Plus className="h-3.5 w-3.5" /> {ACTION_LABELS.addPromiseToPay}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}
    </SectionCard>
  );
}

export function PaymentPromiseTimeline({ events }: { events: PaymentPromiseEventRow[] }) {
  const { configuration } = useRegion();
  const visible = useMemo(() => events.slice(0, 30), [events]);
  if (!visible.length) return null;
  return (
    <SectionCard title="Promise Activity">
      <div className="mt-2 space-y-2">
        {visible.map((event) => (
          <div key={event.id} className="flex gap-2 border-b border-gray-50 pb-2 last:border-0">
            {event.event_type === "fulfilled" ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />
              : <CalendarClock className="mt-0.5 h-4 w-4 text-amber-500" />}
            <div>
              <p className="text-xs font-bold capitalize text-gray-700">{event.event_type.replaceAll("_", " ")}</p>
              <p className="text-[10px] text-gray-400">{formatDateTime(event.created_at, configuration.settings)}</p>
              {event.note && <p className="mt-0.5 text-[11px] text-gray-500">{event.note}</p>}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
