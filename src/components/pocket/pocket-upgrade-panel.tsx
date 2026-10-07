"use client";
import { friendlyErrorMessage } from "@/lib/ui/friendly-error";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";

import type { PocketSoloUpgradeView } from "@/lib/pocket/upgrade-server";
import { PocketInlineError, PocketLoadingState, PocketStatusChip } from "./pocket-ui";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; value: PocketSoloUpgradeView };

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function snapshotReference(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Debt";
  const reference = (value as Record<string, unknown>).reference;
  return typeof reference === "string" && reference.trim() ? reference : "Debt";
}

async function fetchUpgrade(): Promise<PocketSoloUpgradeView> {
  const response = await fetch("/api/pocket/upgrade", { cache: "no-store" });
  const body = await response.json().catch(() => null) as PocketSoloUpgradeView | { error?: string } | null;
  if (!response.ok) throw new Error(body && "error" in body ? body.error : "Upgrade information is unavailable.");
  return body as PocketSoloUpgradeView;
}

export function PocketUpgradePanel() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState({ kind: "ready", value: await fetchUpgrade() });
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : "Upgrade information is unavailable." });
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchUpgrade()
      .then((value) => { if (active) setState({ kind: "ready", value }); })
      .catch((error: unknown) => { if (active) setState({ kind: "error", message: error instanceof Error ? error.message : "Upgrade information is unavailable." }); });
    return () => { active = false; };
  }, []);

  async function startUpgrade() {
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch("/api/pocket/upgrade/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({}),
      });
      const body = await response.json().catch(() => null) as { url?: string; error?: string } | null;
      if (!response.ok || !body?.url) throw new Error(friendlyErrorMessage(body?.error ?? "Solo checkout is unavailable."));
      window.location.assign(body.url);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Solo checkout is unavailable.");
      setBusy(false);
      await load();
    }
  }

  if (state.kind === "loading") return <PocketLoadingState label="Loading upgrade readiness" />;
  if (state.kind === "error") return <div className="mt-6"><PocketInlineError>{state.message}</PocketInlineError></div>;

  const { run, reviewItems } = state.value;
  const counts = run?.source_counts && typeof run.source_counts === "object" && !Array.isArray(run.source_counts)
    ? run.source_counts : {};
  const reviewCount = count(counts.reviewRequired);
  const preserveCount = count(counts.preserveOnly);
  const blocked = run?.status === "review_required" || reviewCount > 0;
  const waiting = run?.status === "checkout_pending" || run?.status === "processing";

  return (
    <div className="mt-6 space-y-5">
      <div className="pocket-card p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-[#087F5B]" />
          <div>
            <h2 className="text-xl font-black text-[#082C32]">One workspace, one financial history</h2>
            <p className="mt-2 text-sm leading-6 text-[#536866]">Your customers, notes, debts, payments, reversals, receipts, reminders, audit history, and linked invoices stay in this workspace. Solo cases point to the existing debt ledger; amounts are not copied.</p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Summary label="Pocket debts" value={count(counts.debts)} />
          <Summary label="Ready for Solo" value={count(counts.migrate)} />
          <Summary label="Preserved only" value={preserveCount} />
        </div>
      </div>

      {run ? <div className="flex flex-wrap gap-2" aria-label="Upgrade status">
        <PocketStatusChip label={run.status.replaceAll("_", " ")} tone={blocked ? "warning" : run.status === "completed" ? "success" : "neutral"} />
        {run.pocket_subscription_cleanup_status !== "not_started" ? <PocketStatusChip label={`Pocket billing cleanup: ${run.pocket_subscription_cleanup_status}`} tone={run.pocket_subscription_cleanup_status === "failed" ? "danger" : run.pocket_subscription_cleanup_status === "completed" ? "success" : "warning"} /> : null}
      </div> : null}

      {blocked ? (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-950" role="alert">
          <div className="flex items-start gap-3"><AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0"/><div><h2 className="font-black">Review required before checkout</h2><p className="mt-1 text-sm leading-6">Disputed, malformed, or already-linked debts are never guessed. Correct these records, then retry preparation.</p></div></div>
          <ul className="mt-4 space-y-2 text-sm">
            {reviewItems.filter((item) => item.status === "review_required").map((item) => <li key={item.id} className="rounded-2xl bg-white/70 p-3"><span className="font-bold">{snapshotReference(item.source_snapshot)}</span><span className="block text-amber-900">{item.review_reason}</span></li>)}
          </ul>
        </div>
      ) : null}

      {preserveCount > 0 ? <p className="rounded-2xl bg-slate-100 p-4 text-sm leading-6 text-slate-700">Cancelled, draft, written-off, and archived debts remain searchable historical records but do not become active Solo cases.</p> : null}

      <div className="pocket-card p-5 sm:p-6">
        <h2 className="text-lg font-black text-[#082C32]">Before you continue</h2>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-[#536866]">
          <li className="flex gap-2"><CheckCircle2 aria-hidden="true" className="mt-1 size-4 shrink-0 text-[#087F5B]"/>The upgrade uses your existing login and workspace.</li>
          <li className="flex gap-2"><CheckCircle2 aria-hidden="true" className="mt-1 size-4 shrink-0 text-[#087F5B]"/>The server verifies every balance immediately before switching products.</li>
          <li className="flex gap-2"><AlertTriangle aria-hidden="true" className="mt-1 size-4 shrink-0 text-amber-600"/>Downgrading from Solo back to Pocket is not supported in this release.</li>
        </ul>
        <button type="button" onClick={startUpgrade} disabled={busy || waiting || run?.status === "completed"}
          className="pocket-primary-action mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 px-5 sm:w-auto">
          {busy ? (blocked ? "Refreshing review…" : "Opening secure checkout…") : waiting ? "Upgrade processing…" : blocked ? "Refresh review" : "Continue to Solo checkout"}
          {!busy && !waiting ? <ArrowRight aria-hidden="true" className="size-4"/> : null}
        </button>
        {actionError ? <div className="mt-4"><PocketInlineError>{actionError}</PocketInlineError></div> : null}
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl bg-[#F2FBF7] p-4"><p className="text-xs font-bold uppercase tracking-wide text-[#536866]">{label}</p><p className="mt-1 text-2xl font-black text-[#082C32]">{value}</p></div>;
}
