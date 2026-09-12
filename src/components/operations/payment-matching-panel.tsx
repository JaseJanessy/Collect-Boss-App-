"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Clock3, RefreshCw, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";

type Queue = "high_confidence_review" | "ambiguous" | "unmatched";
type Transaction = {
  id: string; source_type: string; source_system: string; source_record_id: string;
  amount_minor: number; currency: string; occurred_at: string | null; reference: string | null;
  invoice_number: string | null; party_name: string | null; duplicate_signals: unknown[]; queue_status: string;
};
type Signal = { code: string; label: string; weight: number };
type Candidate = {
  id: string; transaction_id: string; rank: number; score: number; confidence_band: string;
  case_id: string; obligation_id: string | null; matched_signals: Signal[]; conflicting_signals: Signal[];
  reason: string; ranking_reason: string; review_status: string; review_note: string | null;
};

const queueTabs = [
  { value: "high_confidence_review" as const, label: "High-confidence review" },
  { value: "ambiguous" as const, label: "Ambiguous" },
  { value: "unmatched" as const, label: "Unmatched" },
];

function money(amountMinor: number, currency: string) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amountMinor / 100); }
  catch { return `${currency} ${(amountMinor / 100).toFixed(2)}`; }
}

function idempotencyKey(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

export function PaymentMatchingPanel() {
  const [queue, setQueue] = useState<Queue>("high_confidence_review");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy("load");
    const response = await fetch(`/api/payment-matching/transactions?queue=${queue}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as { transactions?: Transaction[]; candidates?: Candidate[]; error?: { message?: string } };
    setTransactions(payload.transactions ?? []);
    setCandidates(payload.candidates ?? []);
    setMessage(response.ok ? null : payload.error?.message ?? "Unable to load payment matching queues.");
    setBusy(null);
  }, [queue]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const candidatesByTransaction = useMemo(() => {
    const grouped = new Map<string, Candidate[]>();
    for (const candidate of candidates) grouped.set(candidate.transaction_id, [...(grouped.get(candidate.transaction_id) ?? []), candidate]);
    return grouped;
  }, [candidates]);

  async function runMatch(transactionId: string) {
    setBusy(transactionId);
    const response = await fetch(`/api/payment-matching/transactions/${transactionId}/match`, {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("match") }, body: "{}",
    });
    const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
    setMessage(response.ok ? "Candidate ranking refreshed. Review is still required before any balance changes." : payload.error?.message ?? "Unable to match this transaction.");
    setBusy(null);
    await load();
  }

  async function review(transactionId: string, candidateId: string, decision: "approve" | "reject" | "defer") {
    if (decision !== "approve" && note.trim().length < 3) {
      setMessage("Add a short review note before rejecting or deferring.");
      return;
    }
    setBusy(candidateId);
    const response = await fetch(`/api/payment-matching/transactions/${transactionId}/review`, {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("review") },
      body: JSON.stringify({ decision, candidateId, note: note.trim() || null, ...(decision === "approve" ? { splitAuthorization: false } : {}) }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
    setMessage(response.ok
      ? decision === "approve" ? "Match approved and posted once to the payment ledger." : `Candidate ${decision === "reject" ? "rejected" : "deferred"}; its history was retained.`
      : payload.error?.message ?? "Unable to save the review decision.");
    setBusy(null);
    if (response.ok) setNote("");
    await load();
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm" aria-labelledby="payment-matching-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="payment-matching-heading" className="text-sm font-bold text-gray-900">Payment candidate matching</h2>
          <p className="mt-1 max-w-3xl text-xs text-gray-500">Deterministic suggestions only. Scores explain supporting and conflicting signals; a person must approve before balances change.</p>
        </div>
        <Button type="button" size="xs" variant="outline" onClick={() => void load()} disabled={busy !== null}>
          <RefreshCw aria-hidden="true" /> Refresh
        </Button>
      </div>
      <Tabs className="mt-4" label="Payment matching queue" value={queue} options={queueTabs} onValueChange={setQueue} />
      <label className="mt-4 block text-xs font-semibold text-gray-600">Review note (required for reject or defer)
        <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000}
          className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs font-normal" placeholder="Record the reviewer’s reason" />
      </label>
      {message && <p role="status" className="mt-3 rounded-lg bg-slate-50 p-3 text-xs font-semibold text-slate-700">{message}</p>}
      {busy === "load" ? <p className="mt-4 text-xs text-gray-500">Loading review queue…</p>
        : transactions.length === 0 ? <p className="mt-4 rounded-lg bg-gray-50 p-4 text-xs text-gray-600">No transactions are in this queue.</p>
          : <div className="mt-4 space-y-4">{transactions.map((transaction) => {
            const transactionCandidates = (candidatesByTransaction.get(transaction.id) ?? []).filter((candidate) => ["pending", "deferred"].includes(candidate.review_status));
            return <article key={transaction.id} className="rounded-xl border border-gray-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-gray-900">{money(Number(transaction.amount_minor), transaction.currency)}</p>
                  <p className="mt-1 text-xs text-gray-500">{transaction.source_type.replaceAll("_", " ")} · {transaction.source_system} · {transaction.occurred_at ? new Date(transaction.occurred_at).toLocaleString() : "date unavailable"}</p>
                  <p className="mt-1 text-xs text-gray-600">Reference: {transaction.reference ?? "—"} · Invoice: {transaction.invoice_number ?? "—"} · Party: {transaction.party_name ?? "—"}</p>
                </div>
                <Button type="button" size="xs" variant="outline" onClick={() => void runMatch(transaction.id)} disabled={busy !== null}>Run matching</Button>
              </div>
              {transaction.duplicate_signals.length > 0 && <p className="mt-3 flex gap-1.5 rounded-lg bg-amber-50 p-2 text-xs font-semibold text-amber-800"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> Duplicate signals exist; approval remains blocked to one allocation unless an authorized split is submitted.</p>}
              {transactionCandidates.length === 0 ? <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-500"><SearchX className="h-4 w-4" aria-hidden="true" /> No actionable candidate. Run matching after invoices or identifiers change.</p>
                : <ol className="mt-3 space-y-3">{transactionCandidates.map((candidate) => <li key={candidate.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-bold text-gray-900">#{candidate.rank} · score {candidate.score}/100 · {candidate.confidence_band} · case {candidate.case_id}</p>
                    <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold uppercase text-gray-600">{candidate.review_status}</span>
                  </div>
                  <p className="mt-2 text-xs text-gray-700">{candidate.reason}</p>
                  <p className="mt-1 text-xs font-semibold text-gray-600">{candidate.ranking_reason}</p>
                  <div className="mt-2 flex flex-wrap gap-1">{candidate.matched_signals.map((signal) => <span key={signal.code} className="rounded bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-800">+{signal.weight} {signal.label}</span>)}</div>
                  {candidate.conflicting_signals.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{candidate.conflicting_signals.map((signal) => <span key={signal.code} className="rounded bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-900">{signal.weight} {signal.label}</span>)}</div>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" size="xs" onClick={() => void review(transaction.id, candidate.id, "approve")} disabled={busy !== null}><Check aria-hidden="true" /> Approve</Button>
                    <Button type="button" size="xs" variant="outline" onClick={() => void review(transaction.id, candidate.id, "defer")} disabled={busy !== null}><Clock3 aria-hidden="true" /> Defer</Button>
                    <Button type="button" size="xs" variant="destructive" onClick={() => void review(transaction.id, candidate.id, "reject")} disabled={busy !== null}>Reject</Button>
                  </div>
                </li>)}</ol>}
            </article>;
          })}</div>}
      <p className="mt-4 text-[11px] text-gray-500">Split allocations are available only through the permission-checked review API and require an explicit split authorization plus allocations that exactly equal the transaction amount.</p>
    </section>
  );
}

