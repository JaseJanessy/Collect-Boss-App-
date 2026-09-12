"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, History, Search } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { minorToDecimalString } from "@/lib/financial/money";
import type { DiscrepancyFindingDto, DiscrepancyResponse, FindingStatus } from "@/lib/discrepancies/api-types";
import type { DiscrepancySourceRef } from "@/lib/discrepancies/engine";

const stateLabels = { suspicious: "Suspicious", inconsistent: "Inconsistent", incomplete: "Incomplete", confirmed_error: "Confirmed error" } as const;
const statusLabels: Record<FindingStatus, string> = { open: "Open", confirmed: "Confirmed", dismissed: "Dismissed", deferred: "Deferred", resolved: "Resolved" };
const resolutionKinds = ["Balance reconciled", "Credit allocated", "Payment matched", "Accounting sync corrected", "Invoice record corrected", "Other authorised correction"];

function sourcesOf(finding: DiscrepancyFindingDto) {
  return Array.isArray(finding.source_references) ? finding.source_references as unknown as DiscrepancySourceRef[] : [];
}

function valuesOf(finding: DiscrepancyFindingDto) {
  return finding.conflicting_values && typeof finding.conflicting_values === "object" && !Array.isArray(finding.conflicting_values)
    ? finding.conflicting_values as Record<string, unknown> : {};
}

export function DiscrepancyCard({ caseId, currency, canManage, data, loading, busy, error, onScan, onTransition }: {
  caseId: string; currency: string; canManage: boolean; data: DiscrepancyResponse | null; loading: boolean;
  busy: string | null; error: string | null; onScan: () => Promise<unknown>;
  onTransition: (input: { findingId: string; status: FindingStatus; reason?: string; deferredUntil?: string; correctiveWorkflow?: { href: string; kind: string } }) => Promise<unknown>;
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [deferDates, setDeferDates] = useState<Record<string, string>>({});
  const [resolutionKind, setResolutionKind] = useState<Record<string, string>>({});
  const money = (value: string, itemCurrency = currency) => `${itemCurrency} ${minorToDecimalString(BigInt(value), itemCurrency)}`;
  const active = data?.findings.filter((item) => ["open", "confirmed", "deferred"].includes(item.status)) ?? [];
  const history = data?.findings.filter((item) => ["dismissed", "resolved"].includes(item.status)) ?? [];

  const decide = async (finding: DiscrepancyFindingDto, status: FindingStatus) => {
    const reason = reasons[finding.id]?.trim();
    const deferredUntil = status === "deferred" && deferDates[finding.id] ? new Date(`${deferDates[finding.id]}T12:00:00`).toISOString() : undefined;
    const correctiveWorkflow = status === "resolved" ? {
      href: `/cases/${encodeURIComponent(caseId)}?section=financials`, kind: resolutionKind[finding.id] ?? resolutionKinds[0],
    } : undefined;
    const result = await onTransition({ findingId: finding.id, status, reason, deferredUntil, correctiveWorkflow });
    if (result) setReasons((current) => ({ ...current, [finding.id]: "" }));
  };

  return <SectionCard title="Balance discrepancies" action={data ? `${data.summary.openCount} active · ${money(data.summary.impactedAmountMinor)}` : undefined}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="max-w-2xl text-xs leading-5 text-slate-600">Review-only findings explain where records disagree. They never change approved financial records or trigger debtor communication or escalation.</p>
      {canManage && <button type="button" onClick={() => void onScan()} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><Search className="h-3.5 w-3.5" />{busy === "scan" ? "Scanning…" : "Run review scan"}</button>}
    </div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
    {loading ? <p className="mt-4 text-sm text-slate-500">Loading findings…</p> : active.length === 0 ? <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4" />No active findings are recorded. Run a scan after source data changes.</div> : <div className="mt-4 space-y-3">
      {active.map((finding) => <article key={finding.id} className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-700" /><h4 className="text-sm font-bold text-slate-900">{finding.title}</h4><span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">{stateLabels[finding.state_class]}</span><span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">{finding.severity}</span></div><p className="mt-2 text-xs leading-5 text-slate-700">{finding.explanation}</p></div><div className="text-right"><p className="text-sm font-black text-slate-900">{money(finding.impacted_amount_minor, finding.currency)}</p><p className="text-[10px] uppercase text-slate-500">{finding.confidence} · {finding.confidence_score}%</p></div></div>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">{Object.entries(valuesOf(finding)).map(([key, value]) => <div key={key} className="rounded-lg bg-white p-2"><dt className="text-[10px] font-bold uppercase text-slate-400">{key.replaceAll("_", " ")}</dt><dd className="mt-0.5 break-words text-xs font-semibold text-slate-700">{String(value)}</dd></div>)}</dl>
        <div className="mt-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Cited sources</p><ul className="mt-1 space-y-1">{sourcesOf(finding).map((source) => <li key={`${source.table}:${source.id}:${source.field ?? ""}`} className="text-xs text-slate-600"><span className="font-semibold">{source.label}</span> · {source.table} / {source.id}{source.field ? ` / ${source.field}` : ""}{source.value ? ` = ${source.value}` : ""}{source.locator ? ` · ${source.locator}` : ""}</li>)}</ul></div>
        <p className="mt-3 rounded-lg bg-white p-2 text-xs text-slate-700"><span className="font-bold">Recommended review:</span> {finding.recommended_action}</p>
        {finding.status_reason && <p className="mt-2 text-xs text-slate-600"><span className="font-semibold">Recorded reason:</span> {finding.status_reason}</p>}
        {canManage && <div className="mt-3 border-t border-amber-200 pt-3"><label className="text-[10px] font-bold uppercase text-slate-500" htmlFor={`reason-${finding.id}`}>Review reason</label><textarea id={`reason-${finding.id}`} value={reasons[finding.id] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [finding.id]: event.target.value }))} maxLength={1000} className="mt-1 min-h-16 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs" placeholder="Required to confirm, dismiss, or resolve" />
          <div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy !== null || (reasons[finding.id]?.trim().length ?? 0) < 3} onClick={() => void decide(finding, "confirmed")} className="rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-bold text-red-700 disabled:opacity-40">Confirm error</button><button type="button" disabled={busy !== null || (reasons[finding.id]?.trim().length ?? 0) < 3} onClick={() => void decide(finding, "dismissed")} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-40">Dismiss</button>
            <input aria-label={`Defer ${finding.title} until`} type="date" value={deferDates[finding.id] ?? ""} onChange={(event) => setDeferDates((current) => ({ ...current, [finding.id]: event.target.value }))} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs" /><button type="button" disabled={busy !== null || !deferDates[finding.id]} onClick={() => void decide(finding, "deferred")} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-40">Defer</button>
            <select aria-label={`Corrective workflow for ${finding.title}`} value={resolutionKind[finding.id] ?? resolutionKinds[0]} onChange={(event) => setResolutionKind((current) => ({ ...current, [finding.id]: event.target.value }))} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs">{resolutionKinds.map((kind) => <option key={kind}>{kind}</option>)}</select><button type="button" disabled={busy !== null || (reasons[finding.id]?.trim().length ?? 0) < 3} onClick={() => void decide(finding, "resolved")} className="rounded-lg bg-emerald-700 px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-40">Resolve via workflow</button></div>
        </div>}
      </article>)}
    </div>}
    {history.length > 0 && <details className="mt-4 rounded-xl border border-slate-200 bg-white p-3"><summary className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-700"><History className="h-4 w-4" />Decision history ({history.length})</summary><ul className="mt-3 space-y-2">{history.map((finding) => <li key={finding.id} className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 p-2 text-xs"><div><p className="font-semibold text-slate-800">{finding.title}</p><p className="text-slate-500">{finding.status_reason}</p></div><span className="inline-flex items-center gap-1 font-bold text-slate-600"><Clock3 className="h-3.5 w-3.5" />{statusLabels[finding.status]}</span></li>)}</ul></details>}
  </SectionCard>;
}

