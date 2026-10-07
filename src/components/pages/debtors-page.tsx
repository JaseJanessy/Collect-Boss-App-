"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from "react";
import { Archive, Building2, Pencil, Plus, Search, User, WalletCards, X } from "lucide-react";
import type { DebtorRow, DebtorType } from "@/lib/supabase/types";
import { CustomerReceivablesOverview } from "@/components/debtors/customer-receivables-overview";
import { customerService, type CustomerServiceError } from "@/lib/customers/client-service";
import { isServiceRequestError } from "@/lib/data/http-service";

type FormState = { debtor_type: DebtorType; individual_name: string; business_name: string; contact_name: string; registration_no: string; phone: string; email: string; address: string };
const emptyForm: FormState = { debtor_type: "individual", individual_name: "", business_name: "", contact_name: "", registration_no: "", phone: "", email: "", address: "" };
const nameOf = (debtor: DebtorRow) => debtor.debtor_type === "business" ? debtor.business_name : debtor.individual_name;
const formOf = (debtor: DebtorRow): FormState => ({ debtor_type: debtor.debtor_type, individual_name: debtor.individual_name ?? "", business_name: debtor.business_name ?? "", contact_name: debtor.contact_name ?? "", registration_no: debtor.registration_no ?? "", phone: debtor.phone ?? "", email: debtor.email ?? "", address: debtor.address ?? "" });

export function DebtorsPage() {
  const [debtors, setDebtors] = useState<DebtorRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Kept apart from `error` so a failed load is never shown as an empty list.
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editing, setEditing] = useState<DebtorRow | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [duplicates, setDuplicates] = useState<DebtorRow[]>([]);
  const [selected, setSelected] = useState<DebtorRow | null>(null);

  const load = useCallback(async (search = "") => {
    setLoading(true);
    try {
      setDebtors(await customerService.list(search));
      setLoadError("");
    } catch (cause) {
      setDebtors([]);
      setLoadError(cause instanceof Error ? cause.message : "Unable to load customers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
  }

  function beginCreate() {
    setEditing(null); setForm(emptyForm); setDuplicates([]); setError(""); setOpen(true);
  }

  function beginEdit(debtor: DebtorRow) {
    setEditing(debtor); setForm(formOf(debtor)); setDuplicates([]); setError(""); setOpen(true);
  }

  async function save(allowDuplicate = false) {
    setSaving(true); setError("");
    try {
      if (editing) await customerService.update(editing.id, form);
      else await customerService.create(form, allowDuplicate);
      setOpen(false);
      await load(query);
    } catch (cause) {
      if (isServiceRequestError(cause) && cause.status === 409) {
        const duplicateError = cause as CustomerServiceError;
        setDuplicates(duplicateError.body.duplicates ?? []);
        setError("A similar debtor already exists. Review it before creating a separate record.");
        return;
      }
      setError(cause instanceof Error ? cause.message : "Unable to save debtor.");
    } finally {
      setSaving(false);
    }
  }

  async function archive(debtor: DebtorRow) {
    if (!window.confirm("Archive this customer? Linked accounts, obligations and cases will remain unchanged.")) return;
    try {
      await customerService.setArchived(debtor.id, true);
      await load(query);
    } catch {
      setError("Unable to archive debtor.");
    }
  }

  return <div className="mx-auto w-full max-w-5xl">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-black text-[#0D1B3D]">Customers</h1><p className="mt-1 text-sm text-gray-500">Manage customers across accounts, invoices, obligations and recovery cases.</p></div>
      <button onClick={beginCreate} className="inline-flex items-center gap-2 rounded-xl bg-[#009966] px-4 py-2.5 text-sm font-bold text-white"><Plus className="h-4 w-4" />Add customer</button>
    </div>
    <div className="relative mb-4"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(query); }} placeholder="Search name, business, or registration number" className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-10 pr-4 text-sm outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100" /></div>
    {error && !open && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      {loading ? <p className="p-6 text-sm text-gray-500">Loading customers…</p> : loadError ? <div role="alert" className="flex flex-col items-start gap-3 p-6"><p className="text-sm text-red-700">{loadError}</p><button type="button" onClick={() => void load(query)} className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50">Retry</button></div> : debtors.length === 0 ? <p className="p-6 text-sm text-gray-500">No active customers found.</p> : debtors.map((debtor) => <div key={debtor.id} className="flex items-center gap-3 border-b border-gray-100 p-4 last:border-0">
        <div className="rounded-xl bg-emerald-50 p-2 text-[#009966]">{debtor.debtor_type === "business" ? <Building2 className="h-5 w-5" /> : <User className="h-5 w-5" />}</div>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-gray-900">{nameOf(debtor)}</p><p className="truncate text-xs text-gray-500">{debtor.debtor_type === "business" ? debtor.registration_no ?? "Business debtor" : "Individual debtor"}{debtor.contact_name ? " · " + debtor.contact_name : ""}</p></div>
        <button onClick={() => setSelected(debtor)} aria-label={`View accounts for ${nameOf(debtor)}`} className="flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-[#007A52] hover:bg-emerald-50"><WalletCards className="h-4 w-4" /><span className="hidden sm:inline">Accounts</span></button>
        <button onClick={() => beginEdit(debtor)} aria-label="Edit customer" className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"><Pencil className="h-4 w-4" /></button>
        <button onClick={() => void archive(debtor)} aria-label="Archive customer" className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"><Archive className="h-4 w-4" /></button>
      </div>)}
    </div>
    {selected && <CustomerReceivablesOverview customer={selected} onClose={() => setSelected(null)} />}
    {open && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/30 sm:items-center sm:p-5"><div role="dialog" aria-modal="true" aria-labelledby="debtor-dialog-title" className="max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl">
      <div className="mb-4 flex items-center justify-between"><h2 id="debtor-dialog-title" className="text-lg font-black text-[#0D1B3D]">{editing ? "Edit customer" : "Add customer"}</h2><button onClick={() => setOpen(false)} aria-label="Close customer dialog" className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-500"><X className="h-5 w-5" /></button></div>
      <div className="grid grid-cols-2 gap-2">{(["individual", "business"] as const).map((type) => <button key={type} type="button" aria-pressed={form.debtor_type === type} onClick={() => update("debtor_type", type)} className={"rounded-xl border-2 px-3 py-2 text-sm font-bold " + (form.debtor_type === type ? "border-[#009966] bg-emerald-50 text-[#007A52]" : "border-gray-200 text-gray-600")}>{type === "individual" ? "Individual" : "Business"}</button>)}</div>
      <div className="mt-4 grid gap-3">
        <DebtorInput label={form.debtor_type === "business" ? "Registered business name" : "Full name"} value={form.debtor_type === "business" ? form.business_name : form.individual_name} onChange={(value) => update(form.debtor_type === "business" ? "business_name" : "individual_name", value)} required />
        {form.debtor_type === "business" && <DebtorInput label="Registration number" value={form.registration_no} onChange={(value) => update("registration_no", value)} />}
        <DebtorInput label="Contact name" value={form.contact_name} onChange={(value) => update("contact_name", value)} />
        <DebtorInput label="Phone" value={form.phone} onChange={(value) => update("phone", value)} type="tel" />
        <DebtorInput label="Email" value={form.email} onChange={(value) => update("email", value)} type="email" />
        <DebtorInput label="Correspondence address" value={form.address} onChange={(value) => update("address", value)} />
      </div>
      {error && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</p>}
      {duplicates.length > 0 && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-bold">Possible existing debtor</p>{duplicates.map((debtor) => <p key={debtor.id} className="mt-1">{nameOf(debtor)}</p>)}<button type="button" onClick={() => void save(true)} className="mt-2 font-bold underline">Create separate record anyway</button></div>}
      <button disabled={saving} onClick={() => void save()} className="mt-5 w-full rounded-xl bg-[#009966] px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{saving ? "Saving…" : editing ? "Save debtor" : "Create debtor"}</button>
    </div></div>}
  </div>;
}

function DebtorInput({ label, value, onChange, type = "text", required }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean }) {
  return <label className="text-sm font-bold text-gray-700">{label}{required ? " *" : ""}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100" /></label>;
}
