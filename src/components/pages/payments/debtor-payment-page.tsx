"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Copy, LockKeyhole, ShieldAlert, Upload } from "lucide-react";
import { InlineSpinner } from "@/components/ui/loading-spinner";
import { PrimaryButton } from "@/components/ui/primary-button";
import type { PublicPaymentDetails } from "@/lib/public-access/types";
import { formatCurrencyMinor, getCurrencyMetadata, minorToDecimalString } from "@/lib/financial/money";
import { CollectBossWordmark } from "@/components/brand/wordmark";

interface Props {
  token: string;
  payment: PublicPaymentDetails;
}

type FormState = "ready" | "submitting" | "success" | "invalid" | "expired" | "error";

const formatMoney = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-MY", { style: "currency", currency, currencyDisplay: "code" }).format(amount);

export function DebtorPaymentPage({ token, payment }: Props) {
  const [state, setState] = useState<FormState>("ready");
  const [error, setError] = useState<string | null>(null);
  const plannedInstallment = payment.paymentPlanProgress?.nextInstallment;
  const suggestedAmount = plannedInstallment
    ? minorToDecimalString(BigInt(plannedInstallment.amountMinor) - BigInt(plannedInstallment.paidMinor), payment.currency)
    : payment.amountDue.toFixed(getCurrencyMetadata(payment.currency).minorUnit);
  const [amount, setAmount] = useState(payment.amountDue > 0 ? suggestedAmount : "");
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState(payment.invoiceReference ?? "");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [proof, setProof] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [requestName, setRequestName] = useState("");
  const [requestPhone, setRequestPhone] = useState("");
  const [requestSent, setRequestSent] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!payment.otp.verified || !payment.otp.sessionExpiresAt) return;
    const remaining = new Date(payment.otp.sessionExpiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      window.location.reload();
      return;
    }
    const timer = window.setTimeout(() => window.location.reload(), remaining + 250);
    return () => window.clearTimeout(timer);
  }, [payment.otp.sessionExpiresAt, payment.otp.verified]);

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
    form.set("note", note);
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
    <main className="cb-light-surface min-h-screen bg-[#F2F4F7] px-4 py-8">
      <section className="mx-auto max-w-md rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
        <Brand />
        <h1 className="mt-7 text-2xl font-black text-[#0D1B3D]">Secure payment access</h1>
        <p className="mt-1 text-sm leading-relaxed text-gray-500">
          Verify your registered email or mobile to unlock the creditor&apos;s receiving details.
        </p>

        <div className="mt-4 rounded-2xl border border-gray-100 p-4 text-sm text-gray-700">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Creditor</p>
          <p className="mt-1 font-bold text-[#0D1B3D]">{payment.creditor.name}</p>
          {payment.creditor.verificationState === "verified" ? (
            <p className="mt-1 inline-flex rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">
              CollectBoss business review completed
            </p>
          ) : (
            <p className="mt-1 text-[10px] text-amber-700">
              This business is not verified by CollectBoss. Verify the business and recipient independently before paying.
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {payment.creditor.phone && <a href={`tel:${payment.creditor.phone}`} className="text-[#009966] underline">Call creditor</a>}
            {payment.creditor.email && <a href={`mailto:${payment.creditor.email}`} className="text-[#009966] underline">Email creditor</a>}
            {!payment.creditor.phone && !payment.creditor.email && <span className="text-gray-500">Contact details are not available in this link.</span>}
          </div>
        </div>

        <div className="mt-5 rounded-2xl bg-[#F2F4F7] p-4">
          <p className="text-xs font-semibold text-gray-500">Amount due</p>
          <p className="mt-1 text-2xl font-black text-[#0D1B3D]">{formatMoney(payment.amountDue, payment.currency)}</p>
          {payment.invoiceReference && <p className="mt-2 text-xs text-gray-500">Reference: {payment.invoiceReference}</p>}
          {payment.dueDate && <p className="mt-1 text-xs text-gray-500">Due date: {payment.dueDate}</p>}
        </div>

        {payment.paymentPlanProgress && <PlanProgress progress={payment.paymentPlanProgress} currency={payment.currency} />}

        {payment.receivingAccount ? (
          <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Official receiving account</p>
            <Detail label="Bank / payment method" value={`${payment.receivingAccount.bankName} · ${payment.receivingAccount.paymentMethod}`} />
            <Detail label="Account holder" value={payment.receivingAccount.accountHolderName} />
            <Detail label="Account number" value={payment.receivingAccount.accountNumber} copyable />
            {payment.receivingAccount.duitnowId && <Detail label="DuitNow ID" value={payment.receivingAccount.duitnowId} copyable />}
            {payment.invoiceReference && <Detail label="Payment reference" value={payment.invoiceReference} copyable />}
            {payment.receivingAccount.qrUrl && <img src={payment.receivingAccount.qrUrl} alt="Official payment QR code" className="mt-4 h-auto w-full rounded-xl bg-white p-2" />}
            <p className="mt-4 rounded-xl bg-white px-3 py-2 text-xs font-semibold leading-relaxed text-emerald-900">
              Verify the recipient name in your banking app matches {payment.receivingAccount.accountHolderName} before confirming.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-emerald-800">
              Money moves directly to the creditor. CollectBoss does not process or hold this payment.
            </p>
          </div>
        ) : payment.approvalRequired ? (
          <form className="mt-5 space-y-3 rounded-2xl border border-amber-100 bg-amber-50 p-4" onSubmit={requestAccess}>
            <p className="text-sm font-semibold text-amber-900">Payment details require creditor approval.</p>
            {requestSent ? <p className="text-sm text-amber-800">Request sent. Please wait for the creditor to approve access.</p> : <>
              <label className="cb-field-label" htmlFor="access-name">Your name</label>
              <input id="access-name" required autoComplete="name" placeholder="Your name" value={requestName} onChange={(event) => setRequestName(event.target.value)} className="cb-field border-amber-300" />
              <label className="cb-field-label" htmlFor="access-phone">Phone number</label>
              <input id="access-phone" required autoComplete="tel" inputMode="tel" placeholder="Phone number" value={requestPhone} onChange={(event) => setRequestPhone(event.target.value)} className="cb-field border-amber-300" />
              <PrimaryButton fullWidth type="submit">Request payment details</PrimaryButton>
            </>}
          </form>
        ) : payment.accessRequired && !payment.otp.verified ? (
          <OtpUnlockPanel token={token} payment={payment} />
        ) : (
          <div className="mt-5 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">
            Payment instructions are temporarily unavailable. Please contact the creditor directly.
          </div>
        )}

        <SuspiciousReportPanel token={token} />
        <DisputePanel token={token} payment={payment} />

        {payment.receivingAccount && payment.proofStatus === "not_submitted" && <form className="mt-6 space-y-4" onSubmit={submit}>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3">
            <p className="text-sm font-bold text-emerald-900">I&apos;ve Paid</p>
            <p className="mt-0.5 text-xs text-emerald-700">Tell the creditor which payment you made and attach Payment Proof for review.</p>
          </div>
          <div>
            <label htmlFor="proof-amount" className="cb-field-label">Amount paid</label>
            <input id="proof-amount" required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="cb-field" />
          </div>
          <div>
            <label htmlFor="proof-method" className="cb-field-label">Payment method</label>
            <select id="proof-method" value={method} onChange={(event) => setMethod(event.target.value)} className="cb-field">
              <option value="bank_transfer">Bank transfer</option>
              <option value="duitnow_qr">DuitNow QR</option>
              <option value="tng_ewallet">TNG eWallet</option>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
            </select>
          </div>
          <div>
            <label htmlFor="proof-reference" className="cb-field-label">Payment reference</label>
            <input id="proof-reference" value={reference} onChange={(event) => setReference(event.target.value)} maxLength={160} className="cb-field" />
          </div>
          <div>
            <label htmlFor="proof-date" className="cb-field-label">Payment date</label>
            <input id="proof-date" required type="date" max={new Date().toISOString().slice(0, 10)} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className="cb-field" />
          </div>
          <div>
            <span className="cb-field-label">Payment Proof attachment</span>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-gray-300 px-3 py-3 text-sm text-gray-600 hover:bg-gray-50 focus-within:ring-3 focus-within:ring-ring/50">
              <Upload className="h-4 w-4" />
              <span>{proof ? proof.name : "Upload PDF, JPG, or PNG (max 10 MB)"}</span>
              <input required type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" onChange={(event) => setProof(event.target.files?.[0] ?? null)} />
            </label>
          </div>
          <div>
            <label htmlFor="proof-note" className="cb-field-label">Note (optional)</label>
            <textarea id="proof-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={3} className="cb-field min-h-24" placeholder="Anything the creditor should know" />
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

function OtpUnlockPanel({ token, payment }: Props) {
  const [channel, setChannel] = useState<"email" | "sms">(payment.otp.channels[0]?.channel ?? "email");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState<"sending" | "verifying" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function requestCode() {
    setBusy("sending");
    setError(null);
    try {
      const response = await fetch(`/api/public/pay/${encodeURIComponent(token)}/otp/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({})) as {
        error?: string; maskedDestination?: string; resendAfter?: number; retryAfter?: number;
      };
      if (!response.ok) {
        setCooldown(payload.retryAfter ?? 0);
        setError(payload.error ?? "Unable to send a verification code.");
        return;
      }
      const selected = payment.otp.channels.find((item) => item.channel === channel);
      setSentTo(payload.maskedDestination ?? selected?.maskedDestination ?? "your registered contact");
      setCooldown(payload.resendAfter ?? 60);
    } catch {
      setError("Unable to reach the verification service. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function verifyCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit verification code.");
      return;
    }
    setBusy("verifying");
    setError(null);
    try {
      const response = await fetch(`/api/public/pay/${encodeURIComponent(token)}/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "The verification code could not be confirmed.");
        return;
      }
      window.location.reload();
    } catch {
      setError("Unable to reach the verification service. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50 p-4" aria-labelledby="otp-unlock-title">
      <div className="flex items-start gap-3">
        <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
        <div>
          <h2 id="otp-unlock-title" className="text-sm font-bold text-emerald-950">Unlock Payment Details</h2>
          <p className="mt-1 text-xs leading-relaxed text-emerald-800">We will send a one-time code to a registered contact. The code expires in 7 minutes.</p>
        </div>
      </div>
      {payment.otp.channels.length ? (
        <div className="mt-4 space-y-3">
          <div className="grid gap-2">
            {payment.otp.channels.map((option) => (
              <label key={option.channel} className="flex cursor-pointer items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs text-gray-700">
                <input type="radio" name="otp-channel" checked={channel === option.channel} onChange={() => setChannel(option.channel)} />
                <span>{option.channel === "email" ? "Email" : "Mobile"}: <strong>{option.maskedDestination}</strong></span>
              </label>
            ))}
          </div>
          <PrimaryButton fullWidth type="button" onClick={requestCode} disabled={busy !== null || cooldown > 0}>
            {busy === "sending" ? <><InlineSpinner className="text-white" /> Sending…</> : cooldown > 0 ? `Resend in ${cooldown}s` : sentTo ? "Resend code" : "Send verification code"}
          </PrimaryButton>
          {sentTo && (
            <form className="space-y-3 border-t border-emerald-200 pt-3" onSubmit={verifyCode}>
              <label className="block text-xs font-semibold text-emerald-900" htmlFor="payment-otp-code">Code sent to {sentTo}</label>
              <input
                id="payment-otp-code"
                required
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                className="cb-field border-emerald-300 text-center text-lg font-bold tracking-[0.35em]"
                aria-describedby={error ? "payment-otp-error" : undefined}
              />
              <PrimaryButton fullWidth type="submit" disabled={busy !== null || code.length !== 6}>
                {busy === "verifying" ? <><InlineSpinner className="text-white" /> Verifying…</> : "Verify and unlock"}
              </PrimaryButton>
            </form>
          )}
          {error && <div id="payment-otp-error"><InlineError message={error} /></div>}
        </div>
      ) : (
        <p className="mt-4 rounded-xl bg-white px-3 py-2 text-xs text-amber-800">
          No registered email or mobile is available. Contact the creditor to update your details.
        </p>
      )}
    </section>
  );
}

function SuspiciousReportPanel({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("suspicious_payment_request");
  const [details, setDetails] = useState("");
  const [saving, setSaving] = useState(false);
  const [reported, setReported] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/public/pay/${encodeURIComponent(token)}/suspicious`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, details }),
        cache: "no-store",
      });
      if (!response.ok) throw new Error();
      setReported(true);
    } catch {
      setError("Unable to submit this report. Contact the creditor directly if it is safe to do so.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-5 rounded-2xl border border-gray-200 p-4">
      <button type="button" className="flex w-full items-center gap-2 text-left text-sm font-semibold text-gray-700" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <ShieldAlert className="h-4 w-4 text-amber-600" /> Report Suspicious Request
      </button>
      {open && (reported ? (
        <p className="mt-3 text-xs text-emerald-700">Report received. Do not make a payment if the request seems unsafe.</p>
      ) : (
        <form className="mt-3 space-y-3" onSubmit={submit}>
          <label htmlFor="suspicious-category" className="cb-field-label">Concern</label>
          <select id="suspicious-category" value={category} onChange={(event) => setCategory(event.target.value)} className="cb-field">
            <option value="do_not_recognise_business">Do Not Recognise Business</option>
            <option value="do_not_recognise_amount">Do Not Recognise Amount</option>
            <option value="wrong_payment_details">Wrong Payment Details</option>
            <option value="suspicious_payment_request">Suspicious Payment Request</option>
            <option value="suspected_illegal_lending">Suspected Illegal Lending</option>
            <option value="other">Other concern</option>
          </select>
          <label htmlFor="suspicious-details" className="cb-field-label">Details (optional)</label>
          <textarea id="suspicious-details" value={details} onChange={(event) => setDetails(event.target.value)} maxLength={1000} rows={3} className="cb-field min-h-24" placeholder="Optional details" />
          {error && <InlineError message={error} />}
          <PrimaryButton fullWidth type="submit" disabled={saving}>{saving ? "Submitting…" : "Submit report"}</PrimaryButton>
        </form>
      ))}
    </section>
  );
}

const disputeCategories = [
  ["amount_incorrect", "Amount Incorrect"],
  ["already_paid", "Already Paid"],
  ["duplicate_invoice", "Duplicate Invoice"],
  ["goods_not_received", "Goods Not Received"],
  ["damaged_quality_issue", "Damaged / Quality Issue"],
  ["service_incomplete", "Service Incomplete"],
  ["incorrect_pricing", "Incorrect Pricing"],
  ["do_not_recognise_debt", "Do Not Recognise Debt"],
  ["other", "Other"],
] as const;

function DisputePanel({ token, payment }: Props) {
  const active = payment.dispute.active;
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const firstOption = payment.dispute.options[0];
  const [obligationId, setObligationId] = useState(firstOption?.obligationId ?? "");
  const selected = payment.dispute.options.find((option) => (option.obligationId ?? "") === obligationId) ?? firstOption;
  const [category, setCategory] = useState("amount_incorrect");
  const [amount, setAmount] = useState(selected ? minorToDecimalString(BigInt(selected.balanceMinor), payment.currency) : "");
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [evidence, setEvidence] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  async function submitDispute(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(null);
    const form = new FormData();
    form.set("category", category); form.set("amount", amount);
    form.set("obligationId", obligationId); form.set("reason", reason);
    form.set("description", description); form.set("idempotencyKey", idempotencyKey);
    if (evidence) form.set("evidence", evidence);
    try {
      const response = await fetch(`/api/public/pay/${encodeURIComponent(token)}/dispute`, {
        method: "POST", body: form, cache: "no-store",
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) setError(payload.error ?? "Unable to submit your issue.");
      else setSubmitted(true);
    } catch {
      setError("Unable to reach the dispute service.");
    } finally {
      setSaving(false);
    }
  }

  if (active || submitted) return (
    <section className="mt-5 rounded-2xl border border-amber-100 bg-amber-50 p-4">
      <p className="text-sm font-bold text-amber-900">{submitted ? "Your issue was submitted" : "Amount issue under review"}</p>
      <p className="mt-1 text-xs leading-relaxed text-amber-800">
        The creditor will review it. The amount not disputed is {active ? formatCurrencyMinor(BigInt(active.undisputedAmountMinor), payment.currency, { explicitCode: true }) : formatMoney(payment.collectableAmount, payment.currency)}.
      </p>
      {active?.creditorResponse && <p className="mt-2 text-xs text-amber-900">Creditor response: {active.creditorResponse}</p>}
    </section>
  );

  return <section className="mt-5 rounded-2xl border border-gray-200 p-4">
    {!open ? <button type="button" onClick={() => setOpen(true)}
      className="text-left text-sm font-bold text-[#0D1B3D] underline decoration-amber-400 underline-offset-4">
      I have an issue with this amount.
    </button> : <form className="space-y-3" onSubmit={submitDispute}>
      <div>
        <p className="text-sm font-bold text-[#0D1B3D]">I have an issue with this amount.</p>
        <p className="mt-1 text-xs text-gray-500">Tell the creditor what looks wrong. The original invoice will remain on record.</p>
      </div>
      {payment.dispute.options.length > 1 && <label className="block text-xs font-semibold text-gray-600">Invoice
        <select value={obligationId} onChange={(event) => {
          setObligationId(event.target.value);
          const option = payment.dispute.options.find((item) => (item.obligationId ?? "") === event.target.value);
          if (option) setAmount(minorToDecimalString(BigInt(option.balanceMinor), payment.currency));
        }} className="cb-field mt-1">
          {payment.dispute.options.map((option) => <option key={option.obligationId ?? "case"} value={option.obligationId ?? ""}>{option.reference}</option>)}
        </select>
      </label>}
      <label className="block text-xs font-semibold text-gray-600">Issue type
        <select value={category} onChange={(event) => setCategory(event.target.value)}
          className="cb-field mt-1">
          {disputeCategories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="block text-xs font-semibold text-gray-600">Amount you disagree with
        <input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)}
          className="cb-field mt-1" />
      </label>
      <label className="block text-xs font-semibold text-gray-600">Short reason
        <input required maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)}
          className="cb-field mt-1" />
      </label>
      <label className="block text-xs font-semibold text-gray-600">What happened?
        <textarea required minLength={5} maxLength={2000} rows={4} value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="cb-field mt-1 min-h-28" />
      </label>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-gray-300 px-3 py-3 text-xs text-gray-600 focus-within:ring-3 focus-within:ring-ring/50">
        <Upload className="h-4 w-4" />{evidence ? evidence.name : "Attach evidence (optional)"}
        <input type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only"
          onChange={(event) => setEvidence(event.target.files?.[0] ?? null)} />
      </label>
      {error && <InlineError message={error} />}
      <div className="flex gap-2">
        <PrimaryButton type="submit" disabled={saving}>{saving ? "Submitting…" : "Submit issue"}</PrimaryButton>
        <button type="button" onClick={() => setOpen(false)} className="px-3 text-xs font-bold text-gray-500">Cancel</button>
      </div>
    </form>}
  </section>;
}

function Brand() {
  return <CollectBossWordmark />;
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
    <main className="cb-light-surface min-h-screen bg-[#F2F4F7] px-4 py-8">
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
  const proofLabels: Record<PublicPaymentDetails["proofStatus"], string> = {
    not_submitted: "No proof submitted through this link yet",
    submitted: "Your proof was submitted",
    under_review: "Your proof is under review",
    confirmed: "Your payment has been confirmed",
    rejected: "Your proof was rejected",
    more_information_required: "The creditor needs more information",
    pending_review: "Your proof is pending review",
    approved: "Your proof has been approved",
  };
  const proofLabel = proofLabels[payment.proofStatus];
  return <section className="mt-6 border-t border-gray-100 pt-5" aria-labelledby="payment-progress-title">
    <h2 id="payment-progress-title" className="text-sm font-bold text-[#0D1B3D]">Payment progress</h2>
    <p className="mt-1 text-xs text-gray-500">{proofLabel}</p>
    {payment.proofReviewMessage && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Creditor note: {payment.proofReviewMessage}</p>}
    {payment.approvedPayments.length > 0 ? <ul className="mt-3 space-y-2 rounded-xl bg-gray-50 p-3" aria-label="Approved payment history">
      {payment.approvedPayments.map((item, index) => <li key={`${item.paidAt}-${index}`} className="flex justify-between gap-3 text-xs text-gray-700"><span>{new Date(item.paidAt).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}</span><strong>{formatCurrencyMinor(BigInt(item.amountMinor), payment.currency, { explicitCode: true })}</strong></li>)}
    </ul> : <p className="mt-3 text-xs text-gray-500">No approved payments are shown for this case.</p>}
  </section>;
}

function PlanProgress({ progress, currency }: { progress: NonNullable<PublicPaymentDetails["paymentPlanProgress"]>; currency: string }) {
  const next = progress.nextInstallment;
  const remainingMinor = next ? BigInt(next.amountMinor) - BigInt(next.paidMinor) : 0n;
  const percent = Number(progress.totalMinor) > 0
    ? Math.min(100, Math.round((Number(progress.paidMinor) / Number(progress.totalMinor)) * 100))
    : 0;
  return <section className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50 p-4" aria-labelledby="plan-progress-title">
    <div className="flex items-center justify-between gap-3">
      <h2 id="plan-progress-title" className="text-sm font-bold text-emerald-900">Your payment plan</h2>
      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${progress.status === "defaulted" ? "bg-red-100 text-red-700" : "bg-white text-emerald-700"}`}>
        {progress.status === "defaulted" ? "Payment overdue" : `${progress.paidInstallments}/${progress.installmentCount} paid`}
      </span>
    </div>
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-emerald-100"><div className="h-full rounded-full bg-[#009966]" style={{ width: `${percent}%` }} /></div>
    {next ? <p className="mt-3 text-sm leading-relaxed text-emerald-950">
      Your next payment is <strong>{formatCurrencyMinor(remainingMinor, currency, { explicitCode: true })}</strong>, due <strong>{new Date(`${next.dueDate}T00:00:00`).toLocaleDateString("en-MY", { day: "numeric", month: "long", year: "numeric" })}</strong>.
      {Number(next.paidMinor) > 0 && <> You have already paid {formatCurrencyMinor(BigInt(next.paidMinor), currency, { explicitCode: true })} toward it.</>}
    </p> : <p className="mt-3 text-sm font-semibold text-emerald-800">All installments have been paid.</p>}
  </section>;
}
