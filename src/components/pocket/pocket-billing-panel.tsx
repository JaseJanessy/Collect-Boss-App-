"use client";

import { useEffect, useState } from "react";

import type { PocketEntitlementView } from "@/lib/billing/pocket-entitlements";
import type { PocketOfferKey } from "@/lib/billing/pocket-policy";

type LoadState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; value: PocketEntitlementView };

const labels: Record<PocketOfferKey, string> = {
  pocket_monthly: "Start monthly — RM9.90",
  pocket_annual: "Start annual — RM99",
  pocket_invoice_addon: "Add Simple Invoice — RM10/month",
  pocket_extra_invoice_pack: "Add 30 invoices — RM10 this cycle",
};

export function PocketBillingPanel() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [busy, setBusy] = useState<PocketOfferKey | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/pocket/entitlements", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as PocketEntitlementView | { error?: string } | null;
        if (!response.ok) throw new Error(body && "error" in body ? body.error : "Plan information is unavailable.");
        return body as PocketEntitlementView;
      })
      .then((value) => { if (active) setState({ kind: "ready", value }); })
      .catch((error: unknown) => { if (active) setState({ kind: "error", message: error instanceof Error ? error.message : "Plan information is unavailable." }); });
    return () => { active = false; };
  }, []);

  async function checkout(offerKey: PocketOfferKey) {
    setBusy(offerKey); setActionError(null);
    try {
      const response = await fetch("/api/pocket/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ offerKey }),
      });
      const body = await response.json().catch(() => null) as { url?: string; error?: string } | null;
      if (!response.ok || !body?.url) throw new Error(body?.error ?? "Checkout is unavailable.");
      window.location.assign(body.url);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Checkout is unavailable.");
      setBusy(null);
    }
  }

  if (state.kind === "loading") return <p className="mt-6 text-sm text-slate-600" role="status">Loading plan and limits…</p>;
  if (state.kind === "error") return <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="alert">{state.message}</div>;

  const value = state.value;
  const receipt = value.capabilities["pocket.receipt.process"];
  const invoice = value.capabilities["pocket.invoice.create"];
  const debt = value.capabilities["pocket.debt.manage"];
  const baseLabel = value.baseOffer === "pocket_annual" ? "Pocket Annual" : value.baseOffer === "pocket_monthly" ? "Pocket Monthly" : "Pocket not active";
  const availableOffers: PocketOfferKey[] = value.baseOffer
    ? !value.addOns.simpleInvoice
      ? ["pocket_invoice_addon"]
      : !value.addOns.extraInvoicePack
        ? ["pocket_extra_invoice_pack"]
        : []
    : ["pocket_monthly", "pocket_annual"];
  return (
    <div className="mt-6 space-y-5">
      <div className="rounded-3xl border border-emerald-950/10 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-sm font-bold text-[#087F5B]">Current plan</p><h2 className="mt-1 text-2xl font-black text-[#092F2A]">{baseLabel}</h2></div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-800">{value.lifecycleState.replaceAll("_", " ")}</span>
        </div>
        {value.readOnly ? <p className="mt-4 rounded-2xl bg-amber-50 p-3 text-sm text-amber-950">Your data remains available. New write actions are paused while this workspace is read-only.</p> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Limit label="Active debts" used={debt?.used ?? null} limit={debt?.limit ?? 100} />
        <Limit label="Receipt processing" used={receipt?.used ?? 0} limit={receipt?.limit ?? 100} />
        <Limit label="Simple invoices" used={invoice?.used ?? 0} limit={invoice?.limit ?? 0} />
      </div>
      <div className="rounded-3xl border border-emerald-950/10 bg-white p-6">
        <h2 className="text-lg font-black text-[#092F2A]">Plans and add-ons</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">Monthly and annual plans include the same Pocket features. The invoice pack applies once to the current billing cycle.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {availableOffers.map((offerKey) => (
            <button key={offerKey} type="button" disabled={busy !== null || value.readOnly}
              onClick={() => checkout(offerKey)}
              className="min-h-12 rounded-2xl bg-[#087F5B] px-4 py-3 text-sm font-bold text-white outline-none hover:bg-[#06684b] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[#087F5B] focus-visible:ring-offset-2">
              {busy === offerKey ? "Opening checkout…" : labels[offerKey]}
            </button>
          ))}
        </div>
        {value.addOns.extraInvoicePack ? <p className="mt-4 text-sm font-semibold text-emerald-800">The one-time 30-invoice pack is active for this cycle. The hard maximum is 60 issued invoices.</p> : null}
        {actionError ? <p className="mt-4 text-sm font-semibold text-red-700" role="alert">{actionError}</p> : null}
      </div>
    </div>
  );
}

function Limit({ label, used, limit }: { label: string; used: number | null; limit: number | null }) {
  return <div className="rounded-2xl border border-emerald-950/10 bg-white p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-xl font-black text-[#092F2A]">{used === null ? "—" : used} / {limit ?? "Unlimited"}</p></div>;
}
