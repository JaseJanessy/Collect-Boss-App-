"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { InlineSpinner } from "@/components/ui/loading-spinner";
import { PrimaryButton } from "@/components/ui/primary-button";
import type { PublicAcknowledgementDetails } from "@/lib/public-access/types";
import { formatCurrencyMinor } from "@/lib/financial/money";
import { CollectBossWordmark } from "@/components/brand/wordmark";

interface Props {
  token: string;
  plan: PublicAcknowledgementDetails;
}

type FormState = "ready" | "submitting" | "success" | "invalid" | "expired" | "error";

const formatMoney = (minor: string, currency: string) =>
  formatCurrencyMinor(BigInt(minor), currency, { explicitCode: true });

export function DebtorAcknowledgementPage({ token, plan }: Props) {
  const [state, setState] = useState<FormState>("ready");
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  async function respond(decision: "accepted" | "rejected") {
    if (state === "submitting" || state === "success") return;

    setState("submitting");
    setError(null);
    try {
      const response = await fetch(`/api/public/acknowledge/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ signerName: name, signerPhone: phone, consentAccepted: accepted, decision, rejectionReason }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) {
        setState("success");
      } else if (response.status === 404) {
        setState("invalid");
      } else if (response.status === 410) {
        setState("expired");
      } else {
        setState("error");
        setError(typeof payload.error === "string" ? payload.error : "Unable to submit acknowledgement.");
      }
    } catch {
      setState("error");
      setError("Unable to reach the acknowledgement service. Please try again.");
    }
  }

  if (state === "success") return <StateView title="Payment-plan response saved" message="The creditor has been notified of your response." success />;
  if (state === "invalid") return <StateView title="Invalid acknowledgement link" message="This acknowledgement link cannot be used." />;
  if (state === "expired") return <StateView title="Acknowledgement link expired" message="Ask the creditor for a new acknowledgement link." />;

  return (
    <main className="min-h-screen bg-[#F2F4F7] px-4 py-8">
      <section className="mx-auto max-w-md rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
        <Brand />
        <h1 className="mt-7 text-2xl font-black text-[#0D1B3D]">Payment plan acknowledgement</h1>
        <p className="mt-1 text-sm leading-relaxed text-gray-500">Review the payment-plan terms before confirming your acknowledgement.</p>

        <div className="mt-4 rounded-2xl border border-gray-100 p-4 text-sm text-gray-700">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Creditor</p>
          <p className="mt-1 font-bold text-[#0D1B3D]">{plan.creditorName}</p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {plan.creditorPhone && <a href={`tel:${plan.creditorPhone}`} className="text-[#009966] underline">Call creditor</a>}
            {plan.creditorEmail && <a href={`mailto:${plan.creditorEmail}`} className="text-[#009966] underline">Email creditor</a>}
          </div>
        </div>

        <div className="mt-5 rounded-2xl bg-[#F2F4F7] p-4">
          <p className="text-xs font-semibold text-gray-500">Total proposed settlement</p>
          <p className="mt-1 text-2xl font-black text-[#0D1B3D]">{formatMoney(plan.totalMinor, plan.currency)}</p>
          <p className="mt-2 text-xs text-gray-500">{plan.schedule.length} instalments · {plan.frequency} · terms version {plan.termsVersion}</p>
        </div>

        {plan.schedule.length > 0 && <div className="mt-5">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Immutable instalment schedule</p>
          <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-xl border border-gray-100 p-3 text-sm text-gray-700">
            {plan.schedule.map((item) => <li key={item.sequence} className="flex justify-between gap-3"><span>{item.sequence}. {item.dueDate}</span><strong>{formatMoney(item.amountMinor, plan.currency)}</strong></li>)}
          </ul>
        </div>}
        {plan.notes && <p className="mt-4 rounded-xl bg-gray-50 p-3 text-xs leading-relaxed text-gray-600">{plan.notes}</p>}

        <form className="mt-6 space-y-4" onSubmit={(event) => { event.preventDefault(); void respond("accepted"); }}>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-600">Full name</label>
            <input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-600">Phone number (optional)</label>
            <input maxLength={50} value={phone} onChange={(event) => setPhone(event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" />
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-100 p-3 text-sm text-gray-600">
            <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="mt-0.5" />
            <span>I confirm that I have reviewed and acknowledge these payment-plan terms.</span>
          </label>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-600">Reason for rejection (optional)</label>
            <textarea maxLength={500} value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} rows={2} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" />
          </div>
          {error && <div className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs text-red-700"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}
          <PrimaryButton fullWidth size="lg" type="submit" disabled={state === "submitting" || !accepted}>
            {state === "submitting" ? <><InlineSpinner className="text-white" /> Saving…</> : "Acknowledge payment plan"}
          </PrimaryButton>
          <button type="button" disabled={state === "submitting"} onClick={() => void respond("rejected")} className="w-full text-center text-xs font-semibold text-gray-500 underline disabled:opacity-60">Reject this proposal</button>
        </form>
      </section>
    </main>
  );
}

function Brand() {
  return <CollectBossWordmark />;
}

function StateView({ title, message, success = false }: { title: string; message: string; success?: boolean }) {
  return (
    <main className="min-h-screen bg-[#F2F4F7] px-4 py-8">
      <section className="mx-auto max-w-md rounded-3xl bg-white p-8 text-center shadow-sm">
        <Brand />
        {success ? <CheckCircle2 className="mx-auto mt-10 h-12 w-12 text-[#009966]" /> : <AlertCircle className="mx-auto mt-10 h-12 w-12 text-amber-500" />}
        <h1 className="mt-4 text-xl font-black text-[#0D1B3D]">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-500">{message}</p>
      </section>
    </main>
  );
}
