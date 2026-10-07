"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, ReceiptText } from "lucide-react";
import { requestJson } from "@/lib/data/http-service";
import { MALAYSIAN_STATE_CODES } from "@/lib/einvoice/myinvois-document";

type Details = {
  tin: string | null; id_scheme: "BRN" | "NRIC" | "PASSPORT" | "ARMY" | null; id_value: string | null; sst_no: string | null;
  address_line: string | null; city: string | null; postcode: string | null; state_code: string | null;
};

/** Customer details LHDN needs on an e-Invoice. Collapsed until opened. */
export function CustomerTaxDetailsPanel({ debtorId }: { debtorId: string }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ tin: "", idScheme: "BRN", idValue: "", sstNo: "", addressLine: "", city: "", postcode: "", stateCode: "14" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [complete, setComplete] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      const { details } = await requestJson<{ details: Details | null }>(`/api/debtors/${encodeURIComponent(debtorId)}/tax-details`, { cache: "no-store" });
      if (details) setForm({
        tin: details.tin ?? "", idScheme: details.id_scheme ?? "BRN", idValue: details.id_value ?? "", sstNo: details.sst_no ?? "",
        addressLine: details.address_line ?? "", city: details.city ?? "", postcode: details.postcode ?? "", stateCode: details.state_code ?? "14",
      });
      setComplete(Boolean(details && (details.tin || details.id_scheme === "NRIC" || details.id_scheme === "PASSPORT") && details.address_line && details.city));
    } catch {
      setComplete(null);
    }
  }, [debtorId]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await requestJson(`/api/debtors/${encodeURIComponent(debtorId)}/tax-details`, {
        method: "PUT",
        body: JSON.stringify({ ...form, tin: form.tin || null, idValue: form.idValue || null, sstNo: form.sstNo || null, postcode: form.postcode || null }),
      }, "We couldn't save the tax details.");
      setMessage({ tone: "ok", text: "Saved." });
      await load();
    } catch (cause) {
      setMessage({ tone: "error", text: cause instanceof Error ? cause.message : "We couldn't save the tax details." });
    } finally {
      setSaving(false);
    }
  }

  const field = "mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal";
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <div className="rounded-2xl border border-gray-200 p-4">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 text-left">
        <span className="flex items-center gap-2 text-sm font-black text-gray-900"><ReceiptText className="h-4 w-4 text-emerald-700" aria-hidden="true" />e-Invoice details</span>
        <span className={`text-[10px] font-bold ${complete ? "text-emerald-700" : "text-amber-700"}`}>{complete === null ? "" : complete ? "Ready" : "Needed for e-Invoice"}</span>
      </button>
      {open && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-bold text-gray-700">Customer TIN<input value={form.tin} onChange={set("tin")} placeholder="C1234567890 (leave blank for individuals)" className={field} /></label>
          <label className="text-xs font-bold text-gray-700">ID type
            <select value={form.idScheme} onChange={set("idScheme")} className={field}>
              <option value="BRN">Business registration (SSM)</option>
              <option value="NRIC">MyKad (IC)</option>
              <option value="PASSPORT">Passport</option>
              <option value="ARMY">Army ID</option>
            </select>
          </label>
          <label className="text-xs font-bold text-gray-700">ID number<input value={form.idValue} onChange={set("idValue")} className={field} /></label>
          <label className="text-xs font-bold text-gray-700">SST no. (if any)<input value={form.sstNo} onChange={set("sstNo")} className={field} /></label>
          <label className="text-xs font-bold text-gray-700 sm:col-span-2">Address<input value={form.addressLine} onChange={set("addressLine")} className={field} /></label>
          <label className="text-xs font-bold text-gray-700">City<input value={form.city} onChange={set("city")} className={field} /></label>
          <label className="text-xs font-bold text-gray-700">Postcode<input value={form.postcode} onChange={set("postcode")} inputMode="numeric" className={field} /></label>
          <label className="text-xs font-bold text-gray-700 sm:col-span-2">State
            <select value={form.stateCode} onChange={set("stateCode")} className={field}>
              {Object.entries(MALAYSIAN_STATE_CODES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#009966] px-4 text-sm font-bold text-white disabled:opacity-50 sm:col-span-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Save e-Invoice details
          </button>
          {message && <p role={message.tone === "error" ? "alert" : "status"} className={`sm:col-span-2 text-sm ${message.tone === "error" ? "text-red-700" : "text-emerald-700"}`}>{message.text}</p>}
        </div>
      )}
    </div>
  );
}
