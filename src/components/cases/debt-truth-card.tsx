"use client";

import { AlertTriangle, CheckCircle2, HelpCircle, History } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { minorToDecimalString } from "@/lib/financial/money";
import type { DebtTruthResponse } from "@/lib/debt-truth/api-types";

export function DebtTruthCard({ data, loading, error, currency }: {
  data: DebtTruthResponse | null; loading: boolean; error: string | null; currency: string;
}) {
  const money = (value: string) => `${currency} ${minorToDecimalString(BigInt(value), currency)}`;
  if (loading) return <SectionCard title="Debt truth"><p className="text-sm text-slate-500">Reconciling approved ledger facts…</p></SectionCard>;
  if (error || !data) return <SectionCard title="Debt truth"><p className="text-sm text-amber-700">{error ?? "Canonical balance unavailable."}</p></SectionCard>;
  const { balance } = data;
  const components = [
    { label: "Approved invoiced amount", value: balance.invoiced_amount_minor !== "0" ? balance.invoiced_amount_minor : balance.original_principal_minor, kinds: ["invoice", "original_principal"] },
    { label: "Net approved adjustments", value: balance.approved_adjustments_minor, kinds: ["adjustment_debit", "adjustment_credit", "write_off"] },
    { label: "Approved fees and interest", value: balance.approved_fees_minor, kinds: ["fee", "interest"] },
    { label: "Credit notes", value: `-${balance.credit_notes_minor}`, kinds: ["credit_note"] },
    { label: "Confirmed payments", value: `-${balance.confirmed_payments_minor}`, kinds: ["payment"] },
  ];
  return <SectionCard title="Debt truth" action={`Ledger version ${balance.version}`}>
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-700"><CheckCircle2 className="h-4 w-4" />Confirmed</div><p className="mt-2 text-xl font-black text-emerald-950">{money(balance.confirmed_outstanding_minor)}</p><p className="mt-1 text-xs text-emerald-800">Approved facts only</p></div>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-amber-700"><AlertTriangle className="h-4 w-4" />Disputed</div><p className="mt-2 text-xl font-black text-amber-950">{money(balance.disputed_amount_minor)}</p><p className="mt-1 text-xs text-amber-800">Excluded from confirmed debt</p></div>
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-3"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-sky-700"><HelpCircle className="h-4 w-4" />Unverified</div><p className="mt-2 text-xl font-black text-sky-950">{money(balance.unverified_amount_minor)}</p><p className="mt-1 text-xs text-sky-800">Not represented as confirmed</p></div>
    </div>
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3"><p className="text-sm font-bold text-slate-900">Balance explanation</p><span className="text-xs font-semibold text-slate-500">Displayed exposure {money(balance.total_displayed_exposure_minor)}</span></div>
      <dl className="mt-3 space-y-3 text-sm">{components.map((component) => {
        const cited = data.events.filter((event) => component.kinds.includes(event.event_kind));
        return <div key={component.label} className="rounded-lg border border-slate-100 p-2.5"><div className="flex justify-between gap-4"><dt className="text-slate-600">{component.label}</dt><dd className="font-semibold text-slate-900">{money(component.value)}</dd></div><ul className="mt-1 space-y-0.5" aria-label={`${component.label} citations`}>{cited.length > 0 ? cited.map((event) => <li key={event.id} className="break-all text-[10px] text-slate-500">Source: {event.source_table} / {event.source_id} · version {event.source_version}</li>) : <li className="text-[10px] text-slate-400">No contributing approved event in this ledger version.</li>}</ul></div>;
      })}</dl>
      {balance.unverified_credit_minor !== "0" && <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">Unverified credits or payment claims of {money(balance.unverified_credit_minor)} are shown for review but do not reduce confirmed debt.</p>}
      <p className="mt-3 text-xs leading-5 text-slate-600">{balance.user_explanation}</p>
      <div className="mt-3 flex items-center gap-2 text-xs text-slate-500"><History className="h-3.5 w-3.5" />{data.versions.length} retained version{data.versions.length === 1 ? "" : "s"}; {data.events.length} cited ledger event{data.events.length === 1 ? "" : "s"}.</div>
    </div>
  </SectionCard>;
}
