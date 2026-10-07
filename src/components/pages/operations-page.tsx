"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { GitMerge } from "lucide-react";
import { PaymentMatchingPanel } from "@/components/operations/payment-matching-panel";
import { CustomerImportPanel } from "@/components/operations/customer-import-panel";

export function OperationsPage({ dashboard = false }: { dashboard?: boolean }) {
  return (
    <div className={`mx-auto max-w-6xl space-y-5 ${dashboard ? "" : "px-4 py-5 pb-24"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Data operations</h1>
          <p className="mt-1 text-sm text-gray-500">Preview and validate every import before an atomic commit. Merge only confirmed duplicates.</p>
        </div>
        <Link href="/cases" className="text-xs font-semibold text-emerald-700">Back to cases</Link>
      </div>

      <CustomerImportPanel />

      <PaymentMatchingPanel />
      <DuplicateMergePanel />
    </div>
  );
}

interface DuplicateGroup {
  identifier: string;
  customers: Array<{ id: string; name: string; registration_no: string | null; phone: string | null; email: string | null; created_at: string }>;
}

function DuplicateMergePanel() {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/operations/duplicates", { cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as { groups?: DuplicateGroup[]; error?: string };
    setGroups(payload.groups ?? []);
    setMessage(response.ok ? null : payload.error ?? "Unable to scan duplicates.");
    setLoading(false);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function merge() {
    const response = await fetch("/api/operations/duplicates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_id: source, target_id: target, reason, confirmation }),
    });
    const payload = await response.json().catch(() => ({})) as {
      error?: string; result?: { cases_preserved?: number; obligations_preserved?: number };
    };
    if (!response.ok) setMessage(payload.error ?? "Merge failed.");
    else {
      setMessage(`Merge completed. Preserved ${payload.result?.cases_preserved ?? 0} cases and ${payload.result?.obligations_preserved ?? 0} obligations.`);
      setSource(""); setTarget(""); setReason(""); setConfirmation("");
      await load();
    }
  }

  const customers = groups.flatMap((group) => group.customers).filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index);
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900"><GitMerge className="h-4 w-4 text-amber-600" /> Controlled duplicate merge</h2>
      <p className="mt-1 text-xs text-gray-500">Only exact registration, email, or normalized phone matches are flagged. A merge moves customer links while preserving cases, payments, documents, obligations and timeline records.</p>
      {loading ? <p className="mt-4 text-xs text-gray-500">Scanning reliable identifiers…</p>
        : groups.length === 0 ? <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-xs font-semibold text-emerald-700">No reliable duplicate groups detected.</p>
          : <>
            <div className="mt-4 space-y-2">
              {groups.map((group) => <div key={group.identifier} className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-xs">
                <p className="font-bold text-amber-900">{group.identifier}</p>
                <p className="mt-1 text-amber-800">{group.customers.map((customer) => customer.name).join(" · ")}</p>
              </div>)}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <MergeSelect label="Source to archive" value={source} onChange={setSource} customers={customers} />
              <MergeSelect label="Target to keep" value={target} onChange={setTarget} customers={customers} />
              <label className="text-xs font-semibold text-gray-600 sm:col-span-2">Operational reason
                <input value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs font-normal" />
              </label>
              <label className="text-xs font-semibold text-gray-600">Type MERGE to confirm
                <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs font-normal" />
              </label>
            </div>
            <button disabled={!source || !target || source === target || reason.trim().length < 3 || confirmation !== "MERGE"}
              onClick={() => void merge()} className="mt-4 rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
              Merge and preserve linked records
            </button>
          </>}
      {message && <p className="mt-3 text-xs font-semibold text-gray-700">{message}</p>}
    </section>
  );
}

function MergeSelect({ label, value, onChange, customers }: {
  label: string; value: string; onChange: (value: string) => void; customers: DuplicateGroup["customers"];
}) {
  return <label className="text-xs font-semibold text-gray-600">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-normal"><option value="">Select customer…</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.id.slice(0, 8)}</option>)}</select></label>;
}
