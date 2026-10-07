"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { requestJson } from "@/lib/data/http-service";
import { MALAYSIAN_STATE_CODES } from "@/lib/einvoice/myinvois-document";

type Profile = {
  enabled: boolean; supplier_tin: string; supplier_brn: string; supplier_sst: string | null; supplier_ttx: string | null;
  msic_code: string; activity_description: string; phone: string; email: string | null; address_line: string; city: string;
  postcode: string; state_code: string; tax_type: "01" | "02" | "06" | "E"; tax_rate_percent: number | string;
  intermediary_authorised_at: string | null;
};

const empty = {
  enabled: false, supplierTin: "", supplierBrn: "", supplierSst: "", msicCode: "", activityDescription: "", phone: "", email: "",
  addressLine: "", city: "", postcode: "", stateCode: "14", taxType: "06" as Profile["tax_type"], taxRatePercent: "0", intermediaryAuthorised: false,
};

/** Business details LHDN needs before CollectBoss can issue e-Invoices for it. */
export function EinvoiceSettingsPanel({ canManage }: { canManage: boolean }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [environment, setEnvironment] = useState("preprod");
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await requestJson<{ available: boolean; environment: string; profile: Profile | null }>("/api/einvoice/profile", { cache: "no-store" });
      setAvailable(payload.available);
      setEnvironment(payload.environment);
      const p = payload.profile;
      if (p) setForm({
        enabled: p.enabled, supplierTin: p.supplier_tin, supplierBrn: p.supplier_brn, supplierSst: p.supplier_sst ?? "",
        msicCode: p.msic_code, activityDescription: p.activity_description, phone: p.phone, email: p.email ?? "",
        addressLine: p.address_line, city: p.city, postcode: p.postcode, stateCode: p.state_code, taxType: p.tax_type,
        taxRatePercent: String(p.tax_rate_percent), intermediaryAuthorised: Boolean(p.intermediary_authorised_at),
      });
    } catch (cause) {
      setMessage({ tone: "error", text: cause instanceof Error ? cause.message : "We couldn't load e-Invoice settings." });
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await requestJson("/api/einvoice/profile", { method: "PUT", body: JSON.stringify(form) }, "We couldn't save your e-Invoice settings.");
      setMessage({ tone: "ok", text: form.enabled ? "Saved. You can now send e-Invoices from each customer's invoices." : "Saved." });
    } catch (cause) {
      setMessage({ tone: "error", text: cause instanceof Error ? cause.message : "We couldn't save your e-Invoice settings." });
    } finally {
      setSaving(false);
    }
  }

  if (available === null) return <p className="mt-2 text-xs text-gray-500">{message?.text ?? "Loading…"}</p>;
  const field = "mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal";
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const disabled = !canManage || !available;

  return (
    <div className="mt-1 flex flex-col gap-3">
      <p className="text-xs text-gray-500">
        Send your invoices to LHDN MyInvois from CollectBoss. Each e-Invoice gets an LHDN validation link you can share with your customer.
      </p>
      {!available && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">e-Invoicing is being set up and will be available soon.</p>}
      {available && environment !== "production" && <p className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">Test mode: documents go to LHDN&apos;s sandbox and are not real tax documents.</p>}

      <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-bold text-gray-700">LHDN TIN<input value={form.supplierTin} onChange={set("supplierTin")} placeholder="C1234567890" className={field} /></label>
        <label className="text-xs font-bold text-gray-700">SSM registration no.<input value={form.supplierBrn} onChange={set("supplierBrn")} placeholder="202401012345" className={field} /></label>
        <label className="text-xs font-bold text-gray-700">MSIC code<input value={form.msicCode} onChange={set("msicCode")} inputMode="numeric" placeholder="46510" className={field} /></label>
        <label className="text-xs font-bold text-gray-700">Business activity<input value={form.activityDescription} onChange={set("activityDescription")} placeholder="Wholesale of hardware" className={field} /></label>
        <label className="text-xs font-bold text-gray-700">Phone<input value={form.phone} onChange={set("phone")} placeholder="+60123456789" className={field} /></label>
        <label className="text-xs font-bold text-gray-700">Email<input value={form.email} onChange={set("email")} type="email" className={field} /></label>
        <label className="text-xs font-bold text-gray-700 sm:col-span-2">Address<input value={form.addressLine} onChange={set("addressLine")} placeholder="Lot 66, Jalan Merdeka" className={field} /></label>
        <label className="text-xs font-bold text-gray-700">City<input value={form.city} onChange={set("city")} className={field} /></label>
        <label className="text-xs font-bold text-gray-700">Postcode<input value={form.postcode} onChange={set("postcode")} inputMode="numeric" className={field} /></label>
        <label className="text-xs font-bold text-gray-700">State
          <select value={form.stateCode} onChange={set("stateCode")} className={field}>
            {Object.entries(MALAYSIAN_STATE_CODES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-gray-700">Tax
          <select value={form.taxType} onChange={set("taxType")} className={field}>
            <option value="06">Not SST-registered</option>
            <option value="02">Service tax</option>
            <option value="01">Sales tax</option>
            <option value="E">Tax exempt</option>
          </select>
        </label>
        {(form.taxType === "01" || form.taxType === "02") && (
          <>
            <label className="text-xs font-bold text-gray-700">Tax rate (%)<input value={form.taxRatePercent} onChange={set("taxRatePercent")} inputMode="decimal" className={field} /></label>
            <label className="text-xs font-bold text-gray-700">SST registration no.<input value={form.supplierSst} onChange={set("supplierSst")} className={field} /></label>
          </>
        )}
        <label className="flex items-start gap-2 rounded-xl border border-gray-200 p-3 text-xs font-semibold text-gray-700 sm:col-span-2">
          <input type="checkbox" className="mt-0.5" checked={form.intermediaryAuthorised} onChange={(event) => setForm((current) => ({ ...current, intermediaryAuthorised: event.target.checked }))} />
          <span>
            I have added CollectBoss as an intermediary for my business in the MyInvois portal.{" "}
            <a href={environment === "production" ? "https://myinvois.hasil.gov.my" : "https://preprod.myinvois.hasil.gov.my"} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[#087F5B] underline">
              Open MyInvois <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </span>
        </label>
        <label className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-3 py-3 text-sm font-bold text-gray-800 sm:col-span-2">
          Turn on e-Invoicing
          <input type="checkbox" className="h-5 w-5 accent-[#009966]" checked={form.enabled} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} />
        </label>
      </fieldset>
      {canManage && (
        <button type="button" onClick={() => void save()} disabled={saving || disabled}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#009966] px-4 text-sm font-bold text-white disabled:opacity-50">
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Save e-Invoice settings
        </button>
      )}
      {message && <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-sm text-red-700" : "text-sm text-emerald-700"}>{message.text}</p>}
    </div>
  );
}
