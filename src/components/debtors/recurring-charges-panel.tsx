"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Loader2, Pause, Play, Repeat, Square } from "lucide-react";
import { requestJson } from "@/lib/data/http-service";
import { ordinalDay } from "@/lib/receivables/recurring";
import type { RecurringChargeRow } from "@/lib/supabase/types";

interface Props {
  accountId: string;
  currency: string;
  formatMinor: (value: number) => string;
  onGenerated?: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);
const emptyForm = () => ({ label: "", amount: "", day_of_month: "1", due_days: "0", start_date: today(), end_date: "" });

/** Monthly repeating charges (rent, retainers, instalments) for one ongoing account. */
export function RecurringChargesPanel({ accountId, currency, formatMinor, onGenerated }: Props) {
  const [charges, setCharges] = useState<RecurringChargeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    try {
      const payload = await requestJson<{ charges: RecurringChargeRow[] }>(`/api/recurring-charges?accountId=${encodeURIComponent(accountId)}`, { cache: "no-store" });
      setCharges(payload.charges);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn't load repeating charges.");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function create() {
    setBusy("create");
    setError("");
    try {
      await requestJson("/api/recurring-charges", {
        method: "POST",
        body: JSON.stringify({
          account_id: accountId,
          label: form.label,
          amount: form.amount,
          day_of_month: Number(form.day_of_month),
          due_days: Number(form.due_days || 0),
          start_date: form.start_date,
          end_date: form.end_date || null,
          obligation_type: /rent|sewa/i.test(form.label) ? "rent" : "invoice",
        }),
      }, "We couldn't save the repeating charge.");
      setForm(emptyForm());
      setOpen(false);
      await load();
      onGenerated?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn't save the repeating charge.");
    } finally {
      setBusy("");
    }
  }

  async function setStatus(charge: RecurringChargeRow, status: RecurringChargeRow["status"]) {
    if (status === "ended" && !window.confirm(`Stop "${charge.label}" for good? Invoices already created stay as they are.`)) return;
    setBusy(charge.id);
    setError("");
    try {
      await requestJson(`/api/recurring-charges/${encodeURIComponent(charge.id)}`, { method: "PATCH", body: JSON.stringify({ status }) },
        "We couldn't update the repeating charge.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn't update the repeating charge.");
    } finally {
      setBusy("");
    }
  }

  const field = "mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal";

  return (
    <div className="mt-3 rounded-xl border border-dashed border-gray-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-black text-gray-800"><Repeat className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />Repeating charges</p>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="min-h-10 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-800">
            Repeat monthly
          </button>
        )}
      </div>

      {loading ? (
        <p className="mt-2 text-[11px] text-gray-500">Loading…</p>
      ) : charges.length === 0 && !open ? (
        <p className="mt-2 text-[11px] text-gray-500">Bill the same amount every month, like rent. CollectBoss creates each invoice on the day and reminds you when it is overdue.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {charges.map((charge) => (
            <li key={charge.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-gray-800">{charge.label} · {formatMinor(charge.amount_minor)}</p>
                <p className="flex items-center gap-1 text-[10px] text-gray-500">
                  <CalendarClock className="h-3 w-3" aria-hidden="true" />
                  {charge.status === "active"
                    ? `Every month on the ${ordinalDay(charge.day_of_month)} · next ${charge.next_run_date}`
                    : charge.status === "paused" ? "Paused" : "Ended"}
                  {charge.last_error ? " · last run needs attention" : ""}
                </p>
              </div>
              {charge.status !== "ended" && (
                <div className="flex gap-1">
                  <button type="button" disabled={busy === charge.id} onClick={() => void setStatus(charge, charge.status === "active" ? "paused" : "active")}
                    aria-label={charge.status === "active" ? `Pause ${charge.label}` : `Resume ${charge.label}`}
                    className="flex min-h-9 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 text-[10px] font-bold text-gray-700 disabled:opacity-50">
                    {charge.status === "active" ? <><Pause className="h-3 w-3" />Pause</> : <><Play className="h-3 w-3" />Resume</>}
                  </button>
                  <button type="button" disabled={busy === charge.id} onClick={() => void setStatus(charge, "ended")} aria-label={`End ${charge.label}`}
                    className="flex min-h-9 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 text-[10px] font-bold text-red-700 disabled:opacity-50">
                    <Square className="h-3 w-3" />End
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-bold text-gray-700 sm:col-span-2">What is it for?
            <input value={form.label} onChange={(e) => setForm((c) => ({ ...c, label: e.target.value }))} placeholder="e.g. Monthly rent, Unit 3A" className={field} />
          </label>
          <label className="text-xs font-bold text-gray-700">Amount ({currency})
            <input value={form.amount} inputMode="decimal" onChange={(e) => setForm((c) => ({ ...c, amount: e.target.value }))} placeholder="1500.00" className={field} />
          </label>
          <label className="text-xs font-bold text-gray-700">Bill on day
            <select value={form.day_of_month} onChange={(e) => setForm((c) => ({ ...c, day_of_month: e.target.value }))} className={field}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{ordinalDay(d)} of each month</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-gray-700">Start from
            <input type="date" value={form.start_date} onChange={(e) => setForm((c) => ({ ...c, start_date: e.target.value }))} className={field} />
          </label>
          <label className="text-xs font-bold text-gray-700">Customer has (days) to pay
            <input value={form.due_days} inputMode="numeric" onChange={(e) => setForm((c) => ({ ...c, due_days: e.target.value }))} placeholder="0" className={field} />
          </label>
          <label className="text-xs font-bold text-gray-700 sm:col-span-2">Stop after (optional)
            <input type="date" value={form.end_date} onChange={(e) => setForm((c) => ({ ...c, end_date: e.target.value }))} className={field} />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" onClick={() => { setOpen(false); setError(""); }} className="min-h-11 flex-1 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600">Cancel</button>
            <button type="button" disabled={busy === "create" || !form.label.trim() || !form.amount.trim()} onClick={() => void create()}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#009966] text-sm font-bold text-white disabled:opacity-50">
              {busy === "create" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Start repeating
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs font-semibold text-red-700">{error}</p>}
    </div>
  );
}
