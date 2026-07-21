"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, Copy, Upload } from "lucide-react";
import { InlineSpinner } from "@/components/ui/loading-spinner";
import { PrimaryButton } from "@/components/ui/primary-button";
import type { PublicPaymentDetails } from "@/lib/public-access/types";

interface Props {
  token: string;
  payment: PublicPaymentDetails;
}

type FormState = "ready" | "submitting" | "success" | "invalid" | "expired" | "error";

const formatRM = (amount: number) =>
  new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(amount);

export function DebtorPaymentPage({ token, payment }: Props) {
  const [state, setState] = useState<FormState>("ready");
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(payment.amountDue > 0 ? payment.amountDue.toFixed(2) : "");
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState(payment.invoiceReference ?? "");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [proof, setProof] = useState<File | null>(null);
  const [requestName, setRequestName] = useState("");
  const [requestPhone, setRequestPhone] = useState("");
  const [requestSent, setRequestSent] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "submitting" || state === "success") return;

    setState("submitting");
    setError(null);
    const form = new FormData();
    form.set("amount", amount);
    form.set("paymentMethod", method);
    form.set("referenceNo", reference);
    form.set("paymentDate", paymentDate);
    form.set("idempotencyKey", idempotencyKey);
    if (proof) form.set("proof", proof);

    try {
      const response = await fetch(`/api/public/pay/${encodeURIComponent(token)}/proof`, {
        method: "POST",
        body: form,
        cache: "no-store",
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
        setError(typeof payload.error === "string" ? payload.error : "Unable to submit payment proof.");
      }
    } catch {
      setState("error");
      setError("Unable to reach the payment service. Please try again.");
    }
  }

  async function requestAccess(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch(`/api/public/pay/${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: requestName, phone: requestPhone }) });
    if (response.ok) setRequestSent(true);
    else setError("Unable to request payment details. Please contact the creditor.");
  }

  if (state === "success") return <SuccessView />;
  if (state === "invalid") return <StateView title="Invalid payment link" message="This payment link cannot be used." />;
  if (state === "expired") return <StateView title="Payment link expired" message="Ask the creditor for a new payment link." />;

  return (
    <main className="min-h-screen bg-[#F2F4F7] px-4 py-8">
      <section className="mx-auto max-w-md rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
        <Brand />
        <h1 className="mt-7 text-2xl font-black text-[#0D1B3D]">Payment details</h1>
        <p className="mt-1 text-sm leading-relaxed text-gray-500">
          Use these details only for this payment. Submitted proof is reviewed by the creditor.
        </p>

        <div className="mt-4 rounded-2xl border border-gray-100 p-4 text-sm text-gray-700">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Creditor</p>
          <p className="mt-1 font-bold text-[#0D1B3D]">{payment.creditor.name}</p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {payment.creditor.phone && <a href={`tel:${payment.creditor.phone}`} className="text-[#009966] underline">Call creditor</a>}
            {payment.creditor.email && <a href={`mailto:${payment.creditor.email}`} className="text-[#009966] underline">Email creditor</a>}
            {!payment.creditor.phone && !payment.creditor.email && <span className="text-gray-500">Contact details are not available in this link.</span>}
          </div>
        </div>

        <div className="mt-5 rounded-2xl bg-[#F2F4F7] p-4">
          <p className="text-xs font-semibold text-gray-500">Amount due</p>
          <p className="mt-1 text-2xl font-black text-[#0D1B3D]">{formatRM(payment.amountDue)}</p>
          {payment.invoiceReference && <p className="mt-2 text-xs text-gray-500">Reference: {payment.invoiceReference}</p>}
          {payment.dueDate && <p className="mt-1 text-xs text-gray-500">Due date: {payment.dueDate}</p>}
        </div>

        {payment.receivingAccount ? (
          <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Official receiving account</p>
            <Detail label="Bank" value={payment.receivingAccount.bankName} />
            <Detail label="Account holder" value={payment.receivingAccount.accountHolderName} />
            <Detail label="Account number" value={payment.receivingAccount.accountNumber} copyable />
            {payment.receivingAccount.duitnowId && <Detail label="DuitNow ID" value={payment.receivingAccount.duitnowId} copyable />}
          </div>
        ) : payment.accessRequired ? (
          <form className="mt-5 space-y-3 rounded-2xl border border-amber-100 bg-amber-50 p-4" onSubmit={requestAccess}>
            <p className="text-sm font-semibold text-amber-900">Payment details require creditor approval.</p>
            {requestSent ? <p className="text-sm text-amber-800">Request sent. Please wait for the creditor to approve access.</p> : <>
              <input required placeholder="Your name" value={requestName} onChange={(event) => setRequestName(event.target.value)} className="w-full rounded-xl border border-amber-200 px-3 py-2 text-sm" />
              <input required placeholder="Phone number" value={requestPhone} onChange={(event) => setRequestPhone(event.target.value)} className="w-full rounded-xl border border-amber-200 px-3 py-2 text-sm" />
              <PrimaryButton fullWidth type="submit">Request payment details</PrimaryButton>
            </>}
          </form>
        ) : (
          <div className="mt-5 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">
            Payment instructions are temporarily unavailable. Please contact the creditor directly.
          </div>
        )}

        {payment.receivingAccount && <form className="mt-6 space-y-4" onSubmit={submit}>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-600">Amount paid</label>
            <input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-600">Payment method</label>
            <select value={method} onChange={(event) => setMethod(event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm">
              <option value="bank_transfer">Bank transfer</option>
              <option value="duitnow_qr">DuitNow QR</option>
              <option value="tng_ewallet">TNG eWallet</option>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-600">Payment reference</label>
            <input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={160} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-600">Payment date</label>
            <input required type="date" max={new Date().toISOString().slice(0, 10)} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-600">Payment proof (optional)</label>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-gray-300 px-3 py-3 text-sm text-gray-600 hover:bg-gray-50">
              <Upload className="h-4 w-4" />
              <span>{proof ? proof.name : "Upload PDF, JPG, or PNG (max 10 MB)"}</span>
              <input type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" onChange={(event) => setProof(event.target.files?.[0] ?? null)} />
            </label>
          </div>

          {error && <InlineError message={error} />}

          <PrimaryButton fullWidth size="lg" type="submit" disabled={state === "submitting" || !payment.receivingAccount}>
            {state === "submitting" ? <><InlineSpinner className="text-white" /> Submitting…</> : "Submit payment proof"}
          </PrimaryButton>
        </form>}

        <PaymentProgress payment={payment} />
      </section>
    </main>
  );
}

function Brand() {
  return <span className="text-xl font-black text-[#0D1B3D]">Collect<span className="text-[#009966]">Boss</span></span>;
}

function Detail({ label, value, copyable = false }: { label: string; value: string; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[11px] text-emerald-700">{label}</p>
        <p className="break-all text-sm font-bold text-gray-900">{value}</p>
      </div>
      {copyable && <button type="button" className="shrink-0 text-emerald-700" onClick={() => { navigator.clipboard.writeText(value).catch(() => {}); setCopied(true); }} aria-label={`Copy ${label}`}>
        {copied ? "Copied" : <Copy className="h-4 w-4" />}
      </button>}
    </div>
  );
}

function SuccessView() {
  return <StateView icon={<CheckCircle2 className="h-12 w-12 text-[#009966]" />} title="Payment proof submitted" message="Your submission is pending creditor review. Your balance will not change until it is approved." success />;
}

function StateView({ title, message, icon, success = false }: { title: string; message: string; icon?: React.ReactNode; success?: boolean }) {
  return (
    <main className="min-h-screen bg-[#F2F4F7] px-4 py-8">
      <section className="mx-auto max-w-md rounded-3xl bg-white p-8 text-center shadow-sm">
        <Brand />
        <div className="mt-10 flex justify-center">{icon ?? <AlertCircle className={`h-12 w-12 ${success ? "text-[#009966]" : "text-amber-500"}`} />}</div>
        <h1 className="mt-4 text-xl font-black text-[#0D1B3D]">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-500">{message}</p>
      </section>
    </main>
  );
}

function InlineError({ message }: { message: string }) {
  return <div className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs text-red-700"><AlertCircle className="h-4 w-4 shrink-0" />{message}</div>;
}

function PaymentProgress({ payment }: { payment: PublicPaymentDetails }) {
  const proofLabel = payment.proofStatus === "not_submitted" ? "No proof submitted through this link yet" : payment.proofStatus === "pending_review" ? "Your proof is pending review" : payment.proofStatus === "approved" ? "Your proof has been approved" : "Your proof was not approved";
  return <section className="mt-6 border-t border-gray-100 pt-5" aria-labelledby="payment-progress-title">
    <h2 id="payment-progress-title" className="text-sm font-bold text-[#0D1B3D]">Payment progress</h2>
    <p className="mt-1 text-xs text-gray-500">{proofLabel}</p>
    {payment.approvedPayments.length > 0 ? <ul className="mt-3 space-y-2 rounded-xl bg-gray-50 p-3" aria-label="Approved payment history">
      {payment.approvedPayments.map((item, index) => <li key={`${item.paidAt}-${index}`} className="flex justify-between gap-3 text-xs text-gray-700"><span>{new Date(item.paidAt).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}</span><strong>{formatRM(Number(item.amountMinor) / 100)}</strong></li>)}
    </ul> : <p className="mt-3 text-xs text-gray-500">No approved payments are shown for this case.</p>}
  </section>;
}
