"use client";

import { useState } from "react";
import { CreditCard, Loader2, ShieldCheck } from "lucide-react";

/** "Pay online now" (FPX / card) through the creditor's own Stripe account. */
export function OnlinePaymentOption({ token, suggestedAmount, currency }: { token: string; suggestedAmount: string; currency: string }) {
  const [amount, setAmount] = useState(suggestedAmount);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const outcome = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("online");

  async function start() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/public/pay/${encodeURIComponent(token)}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const payload = await response.json().catch(() => ({})) as { url?: string; error?: string };
      if (!response.ok || !payload.url) throw new Error(payload.error ?? "We couldn't start online payment. Please try again.");
      window.location.assign(payload.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn't start online payment. Please try again.");
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="online-payment-title" className="mt-5 rounded-2xl border border-[#009966] bg-white p-4">
      <h2 id="online-payment-title" className="flex items-center gap-2 text-sm font-black text-[#0D1B3D]">
        <CreditCard className="h-4 w-4 text-[#009966]" aria-hidden="true" />Pay online now
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-gray-600">
        Pay securely with online banking (FPX) or card. Your payment goes straight to the business, and you don&apos;t need to upload proof.
      </p>
      {outcome === "success" && (
        <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
          Thank you. Your payment was received and the business will confirm it shortly.
        </p>
      )}
      {outcome === "cancelled" && (
        <p role="status" className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Payment was cancelled. You can try again below.</p>
      )}
      <label className="mt-3 block text-xs font-bold text-gray-700">Amount ({currency})
        <input value={amount} inputMode="decimal" onChange={(event) => setAmount(event.target.value)}
          className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal" />
      </label>
      <button type="button" onClick={() => void start()} disabled={busy || !amount.trim()}
        className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#009966] px-4 text-sm font-bold text-white disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="h-4 w-4" aria-hidden="true" />}
        {busy ? "Opening secure payment…" : "Pay with FPX or card"}
      </button>
      {error && <p role="alert" className="mt-2 text-xs font-semibold text-red-700">{error}</p>}
      <p className="mt-2 text-[11px] text-gray-400">Processed by Stripe. CollectBoss never sees your bank or card details.</p>
    </section>
  );
}
