"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CreditCard, ExternalLink, Loader2 } from "lucide-react";
import { requestJson } from "@/lib/data/http-service";

type Status =
  | { available: false; state: "not_connected" }
  | { available: true; state: "not_connected" | "setup_incomplete" | "under_review" }
  | { available: true; state: "active"; payoutsEnabled: boolean };

/** Lets an owner connect their own Stripe account so debtors can pay by FPX or card. */
export function OnlinePaymentsPanel({ canManage }: { canManage: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setStatus(await requestJson<Status>("/api/payments/online", { cache: "no-store" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn't check online payments.");
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function connect() {
    setBusy(true);
    setError("");
    try {
      const { url } = await requestJson<{ url: string }>("/api/payments/online", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: "{}",
      }, "We couldn't open Stripe setup.");
      window.location.assign(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn't open Stripe setup.");
      setBusy(false);
    }
  }

  if (!status) return <p className="mt-2 text-xs text-gray-500">{error || "Loading…"}</p>;

  return (
    <div id="online-payments" className="mt-1 flex flex-col gap-3">
      <p className="text-xs text-gray-500">
        Let customers pay from their payment link with online banking (FPX) or card. Money goes straight into your own Stripe account. Stripe&apos;s fees apply, and CollectBoss adds no fee.
      </p>
      {!status.available && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Online payments are being set up and will be available soon.</p>
      )}
      {status.available && status.state === "active" && (
        <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Online payments are on.{status.payoutsEnabled ? "" : " Stripe still needs your bank details before it can pay out."}
        </p>
      )}
      {status.available && status.state === "under_review" && (
        <p className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">Stripe is reviewing your details. This usually takes a few minutes to a day.</p>
      )}
      {status.available && canManage && status.state !== "active" && (
        <button type="button" onClick={() => void connect()} disabled={busy}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#635BFF] px-4 text-sm font-bold text-white disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CreditCard className="h-4 w-4" aria-hidden="true" />}
          {status.state === "not_connected" ? "Connect with Stripe" : "Continue Stripe setup"}
        </button>
      )}
      {status.available && status.state === "active" && (
        <a href="https://dashboard.stripe.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-[#087F5B]">
          Open my Stripe dashboard <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      )}
      <p className="text-[11px] text-gray-400">Online payments appear under Payments as &quot;verified by Stripe&quot;. Approve them to update the balance.</p>
      {error && <p role="alert" className="text-xs font-semibold text-red-700">{error}</p>}
    </div>
  );
}
