"use client";

import React, { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { PrimaryButton } from "@/components/ui/primary-button";
import { InlineSpinner } from "@/components/ui/loading-spinner";
import { type PaymentLockMode, type PaymentAccessRequestRow, type ReceivingAccountRow } from "@/lib/supabase/types";
import { createPaymentAccessRequestClient, getActiveApprovalForCaseClient, isRequestExpired, timeUntilExpiry } from "@/lib/db/payment-access-client";
import { getPrimaryAccountClient } from "@/lib/db/receiving-accounts-client";
import { createPaymentClient, uploadProofFile, PAYMENT_METHOD_LABELS, PAYMENT_METHOD_ICONS } from "@/lib/db/payments-client";
import { track } from "@/lib/analytics/tracker";
import { type PaymentMethod } from "@/lib/supabase/types";
import { formatRM } from "@/lib/mock-data";
import {
  Lock, ShieldCheck, Phone, Building2, QrCode,
  Copy, Check, Upload, Clock, AlertCircle, CheckCircle2,
  Loader2,
} from "lucide-react";

// ─── Public-safe case info (no bank details, no private contact) ───────────────

export interface PublicCaseInfo {
  id:                string;
  debtor_name:       string;
  debtor_company:    string | null;
  balance:           number;
  amount_owed:       number;
  due_date:          string;
  invoice_no:        string | null;
  payment_lock_mode: PaymentLockMode;
}

// ─── View states ──────────────────────────────────────────────────────────────

type ViewState = "loading" | "locked" | "requesting" | "pending" | "approved" | "expired" | "manual_only";

// ─── Main ─────────────────────────────────────────────────────────────────────

interface Props {
  caseInfo: PublicCaseInfo;
}

export function DebtorPaymentPage({ caseInfo: c }: Props) {
  const [view,      setView]      = useState<ViewState>("loading");
  const [account,   setAccount]   = useState<ReceivingAccountRow | null>(null);
  const [request,   setRequest]   = useState<PaymentAccessRequestRow | null>(null);

  // On mount: check payment_lock_mode and existing approval
  useEffect(() => {
    async function check() {
      if (c.payment_lock_mode === "immediate") {
        // Fetch account details immediately
        const acct = await getPrimaryAccountClient();
        setAccount(acct);
        setView("approved");
        return;
      }

      if (c.payment_lock_mode === "manual") {
        setView("manual_only");
        return;
      }

      // Check for existing valid approval
      const existing = await getActiveApprovalForCaseClient(c.id);
      if (existing) {
        if (isRequestExpired(existing)) {
          setRequest(existing);
          setView("expired");
        } else {
          const acct = await getPrimaryAccountClient();
          setAccount(acct);
          setRequest(existing);
          setView("approved");
        }
        return;
      }

      setView("locked");
    }
    check();
  }, [c.id, c.payment_lock_mode]);

  if (view === "loading") {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <span className="text-xl font-black text-[#0D1B3D]">
            Collect<span className="text-[#009966]">Boss</span>
          </span>
          <div className="w-5 h-5 border-2 border-[#009966] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (view === "manual_only")  return <ManualOnlyView caseInfo={c} />;
  if (view === "pending")      return <PendingView caseInfo={c} />;
  if (view === "expired")      return <ExpiredView caseInfo={c} onRequest={() => setView("requesting")} />;
  if (view === "approved" && account) {
    return <ApprovedView caseInfo={c} account={account} request={request} />;
  }
  if (view === "requesting") {
    return (
      <RequestingView
        caseInfo={c}
        onSuccess={(req) => { setRequest(req); setView("pending"); }}
        onBack={() => setView("locked")}
      />
    );
  }

  return <LockedView caseInfo={c} onRequest={() => setView("requesting")} />;
}

// ─── Header ───────────────────────────────────────────────────────────────────

function Header() {
  return (
    <header className="px-5 py-4 border-b border-gray-100">
      <span className="text-xl font-black text-[#0D1B3D]">
        Collect<span className="text-[#009966]">Boss</span>
      </span>
    </header>
  );
}

// ─── Case summary card ────────────────────────────────────────────────────────

function CaseSummary({ c }: { c: PublicCaseInfo }) {
  return (
    <div className="bg-[#F2F4F7] rounded-2xl p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-[#0D1B3D] flex items-center justify-center text-white font-bold text-sm shrink-0">
          {(c.debtor_company ?? c.debtor_name).slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900 truncate">
            {c.debtor_company ?? c.debtor_name}
          </p>
          <p className="text-[11px] text-gray-400">Ref: {c.id}</p>
        </div>
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-gray-200">
        <p className="text-xs text-gray-500">Outstanding Amount</p>
        <p className="text-xl font-black text-[#0D1B3D]">{formatRM(c.balance > 0 ? c.balance : c.amount_owed)}</p>
      </div>
      {c.invoice_no && (
        <p className="text-[11px] text-gray-400 mt-1">Invoice: {c.invoice_no}</p>
      )}
    </div>
  );
}

// ─── 1. Locked view ───────────────────────────────────────────────────────────

function LockedView({ caseInfo: c, onRequest }: { caseInfo: PublicCaseInfo; onRequest: () => void }) {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Header />
      <div className="flex-1 px-5 py-6 flex flex-col gap-5">
        <div>
          <h1 className="text-xl font-black text-[#0D1B3D]">Payment Details Locked</h1>
          <p className="text-sm text-gray-500 mt-1 leading-relaxed">
            For security, payment instructions are only shown after creditor approval.
          </p>
        </div>
        <CaseSummary c={c} />
        <div className="flex flex-col items-center py-8 text-center">
          <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
            <Lock className="w-9 h-9 text-gray-400" />
          </div>
          <p className="text-sm font-bold text-gray-700">Payment details are currently hidden.</p>
          <div className="mt-4 flex flex-col gap-2 text-left w-full max-w-xs">
            {[
              "Protects receiving account details",
              "Prevents unauthorised payments",
              "Ensures proper payment matching",
            ].map((p) => (
              <div key={p} className="flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-[#009966] shrink-0 mt-0.5" />
                <p className="text-xs text-gray-500">{p}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 mt-auto">
          <PrimaryButton fullWidth size="lg" onClick={onRequest}>
            Request Payment Details
          </PrimaryButton>
          <p className="text-[11px] text-gray-400 text-center">
            You will be notified once access is approved.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── 2. Requesting form ───────────────────────────────────────────────────────

function RequestingView({
  caseInfo: c, onSuccess, onBack,
}: {
  caseInfo: PublicCaseInfo;
  onSuccess: (req: PaymentAccessRequestRow) => void;
  onBack: () => void;
}) {
  const [name,      setName]      = useState("");
  const [phone,     setPhone]     = useState("");
  const [reason,    setReason]    = useState("");
  const [method,    setMethod]    = useState("DuitNow QR");
  const [submitting, setSubmitting] = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  async function handleSubmit() {
    if (!name.trim())  { setError("Please enter your name."); return; }
    if (!phone.trim()) { setError("Please enter your phone number."); return; }
    setSubmitting(true);
    setError(null);
    const result = await createPaymentAccessRequestClient({
      case_id:          c.id,
      requester_name:   name.trim(),
      requester_phone:  phone.trim(),
      otp_verified:     false, // OTP not yet implemented
      preferred_method: method || null,
      reason:           reason.trim() || null,
      status:           "pending",
      access_type:      null,
    });
    if (result.error) {
      setError(result.error);
      setSubmitting(false);
    } else {
      track("payment_access_requested", { case_id: c.id });
      onSuccess(result.data!);
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Header />
      <div className="flex-1 px-5 py-6 flex flex-col gap-5">
        <div>
          <button onClick={onBack} className="text-sm text-gray-400 hover:text-gray-600 mb-3">
            ← Back
          </button>
          <h1 className="text-xl font-black text-[#0D1B3D]">Request Payment Details</h1>
          <p className="text-sm text-gray-500 mt-1">
            Submit your request. You will be notified once approved.
          </p>
        </div>
        <CaseSummary c={c} />
        <div className="flex flex-col gap-3">
          <FormField label="Your Name *" placeholder="e.g. Encik Ahmad" value={name} onChange={setName} />
          <FormField label="Phone Number *" placeholder="e.g. +60 12-345 6789" value={phone} onChange={setPhone} type="tel" />
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">Preferred Payment Method</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-800 outline-none focus:ring-2 focus:ring-emerald-200"
            >
              {["DuitNow QR", "Bank Transfer", "DuitNow QR + Bank Transfer", "Cash"].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <FormField label="Reason (Optional)" placeholder="e.g. Ready to settle outstanding invoice" value={reason} onChange={setReason} />
        </div>
        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
            <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}
        <PrimaryButton fullWidth size="lg" onClick={handleSubmit} disabled={submitting}>
          {submitting
            ? <><InlineSpinner className="text-white" /> Submitting…</>
            : "Submit Request"
          }
        </PrimaryButton>
        <p className="text-[11px] text-gray-400 text-center">
          Do not make any payment until you receive official payment details.
        </p>
      </div>
    </div>
  );
}

// ─── 3. Pending / waiting ─────────────────────────────────────────────────────

function PendingView({ caseInfo: c }: { caseInfo: PublicCaseInfo }) {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Header />
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center py-16">
        <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mb-4">
          <Clock className="w-8 h-8 text-amber-500" />
        </div>
        <h2 className="text-lg font-black text-[#0D1B3D]">Request Sent</h2>
        <p className="text-sm text-gray-500 mt-2 leading-relaxed max-w-xs">
          Your request for case <strong>{c.id}</strong> has been sent to the creditor.
          You will be notified once access is approved.
        </p>
        <div className="mt-6 bg-amber-50 border border-amber-100 rounded-xl p-4 text-left w-full max-w-xs">
          <p className="text-xs font-bold text-amber-800 mb-1">While you wait</p>
          <p className="text-xs text-amber-700 leading-relaxed">
            Most requests are approved within minutes. Do not make any payments
            until you receive the official payment details.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── 4. Expired ───────────────────────────────────────────────────────────────

function ExpiredView({ caseInfo: c, onRequest }: { caseInfo: PublicCaseInfo; onRequest: () => void }) {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Header />
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center py-16 gap-4">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center">
          <Clock className="w-8 h-8 text-gray-400" />
        </div>
        <h2 className="text-lg font-black text-[#0D1B3D]">Access Expired</h2>
        <p className="text-sm text-gray-500 max-w-xs">
          Your previous payment access has expired. Submit a new request to view payment details.
        </p>
        <PrimaryButton size="lg" onClick={onRequest}>
          Request Access Again
        </PrimaryButton>
      </div>
    </div>
  );
}

// ─── 5. Manual only ──────────────────────────────────────────────────────────

function ManualOnlyView({ caseInfo: c }: { caseInfo: PublicCaseInfo }) {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Header />
      <div className="flex-1 px-5 py-6 flex flex-col gap-5">
        <CaseSummary c={c} />
        <div className="flex flex-col items-center py-8 text-center gap-4">
          <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center">
            <Lock className="w-8 h-8 text-amber-400" />
          </div>
          <h2 className="text-lg font-black text-[#0D1B3D]">Contact Creditor Directly</h2>
          <p className="text-sm text-gray-500 max-w-xs leading-relaxed">
            Payment details for this case are managed manually.
            Please contact the creditor directly to receive payment instructions.
          </p>
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-left w-full max-w-xs">
            <p className="text-xs font-bold text-blue-800 mb-1">Do not pay to unknown accounts</p>
            <p className="text-xs text-blue-700 leading-relaxed">
              Only use payment details provided directly by the creditor. Never pay to
              an account you cannot verify.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 6. Approved — show payment details ───────────────────────────────────────

function ApprovedView({
  caseInfo: c, account: acct, request: req,
}: {
  caseInfo: PublicCaseInfo;
  account:  ReceivingAccountRow;
  request:  PaymentAccessRequestRow | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [madePayment,    setMadePayment]    = useState(false);
  const [proofAmount,    setProofAmount]    = useState("");
  const [proofMethod,    setProofMethod]    = useState<PaymentMethod>("bank_transfer");
  const [proofRef,       setProofRef]       = useState(c.id);
  const [proofFile,      setProofFile]      = useState<File | null>(null);
  const [submittingProof, setSubmittingProof] = useState(false);
  const [proofSubmitted,  setProofSubmitted]  = useState(false);
  const [proofError,      setProofError]      = useState<string | null>(null);
  const [proofProgress,   setProofProgress]   = useState(0);

  const METHODS: PaymentMethod[] = ["bank_transfer", "duitnow_qr", "cash", "cheque", "tng_ewallet"];

  async function handleProofSubmit() {
    if (!proofAmount || parseFloat(proofAmount) <= 0) { setProofError("Please enter the amount you paid."); return; }
    setSubmittingProof(true);
    setProofError(null);

    let proofUrl: string | null = null;
    if (proofFile) {
      proofUrl = await uploadProofFile(proofFile, c.id, setProofProgress);
    }

    const result = await createPaymentClient({
      case_id:        c.id,
      amount:         parseFloat(proofAmount),
      payment_method: proofMethod,
      reference_no:   proofRef.trim() || null,
      proof_url:      proofUrl,
      review_status:  "pending_review",
      notes:          "Submitted by debtor via payment page",
    });

    if (result.error) {
      setProofError(result.error);
      setSubmittingProof(false);
      return;
    }
    track("payment_proof_submitted", {
      case_id:        c.id,
      payment_method: proofMethod,
      has_proof_file: !!proofFile,
    });
    setProofSubmitted(true);
    setSubmittingProof(false);
  }

  if (madePayment && !proofSubmitted) {
    return (
      <div className="min-h-screen bg-white flex flex-col">
        <Header />
        <div className="flex-1 px-5 py-6 flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-black text-[#0D1B3D]">Submit Payment Proof</h2>
            <p className="text-sm text-gray-500 mt-1 leading-relaxed">
              Your payment will be verified before the balance is updated.
            </p>
          </div>
          <CaseSummary c={c} />

          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">Amount You Paid (RM) *</label>
            <input type="number" min="0.01" step="0.01" placeholder="0.00"
              value={proofAmount} onChange={(e) => setProofAmount(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 outline-none focus:ring-2 focus:ring-emerald-200" />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">Payment Method</label>
            <div className="grid grid-cols-3 gap-1.5">
              {METHODS.map((m) => (
                <button key={m} onClick={() => setProofMethod(m)}
                  className={cn("flex flex-col items-center gap-1 py-2 px-1 rounded-xl border-2 text-[10px] font-semibold transition-all",
                    proofMethod === m ? "border-[#009966] bg-emerald-50 text-[#009966]" : "border-gray-100 bg-white text-gray-500"
                  )}>
                  <span className="text-base">{PAYMENT_METHOD_ICONS[m]}</span>
                  {PAYMENT_METHOD_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">Payment Reference</label>
            <input type="text" value={proofRef} onChange={(e) => setProofRef(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-mono text-gray-900 outline-none focus:ring-2 focus:ring-emerald-200" />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">Upload Receipt (Optional)</label>
            <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden"
              onChange={(e) => { setProofFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
            <button onClick={() => fileRef.current?.click()}
              className={cn("w-full flex flex-col items-center gap-1.5 py-4 border-2 border-dashed rounded-xl transition-colors text-sm",
                proofFile ? "border-[#009966] bg-emerald-50 text-[#009966]" : "border-gray-200 text-gray-500 hover:border-emerald-300"
              )}>
              {proofFile ? <><CheckCircle2 className="w-5 h-5" />{proofFile.name}</> : <><Upload className="w-5 h-5 text-gray-300" />Upload Receipt</>}
            </button>
            {submittingProof && proofFile && (
              <div className="mt-1 w-full bg-gray-200 rounded-full h-1.5">
                <div className="bg-[#009966] h-1.5 rounded-full" style={{ width: `${proofProgress}%` }} />
              </div>
            )}
          </div>

          {proofError && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
              <p className="text-xs text-red-700">{proofError}</p>
            </div>
          )}

          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
            <p className="text-xs text-amber-800 leading-relaxed">
              <strong>Note:</strong> Your payment will be reviewed by the creditor
              before the balance is updated. Do not make multiple payments.
            </p>
          </div>

          <PrimaryButton fullWidth size="lg" onClick={handleProofSubmit} disabled={submittingProof}>
            {submittingProof ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</> : "Submit Proof"}
          </PrimaryButton>
          <button onClick={() => setMadePayment(false)} className="text-sm text-gray-400 text-center">
            ← Back
          </button>
        </div>
      </div>
    );
  }

  if (proofSubmitted) {
    return (
      <div className="min-h-screen bg-white flex flex-col">
        <Header />
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center py-16 gap-4">
          <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8 text-[#009966]" />
          </div>
          <h2 className="text-lg font-black text-[#0D1B3D]">Proof Submitted</h2>
          <p className="text-sm text-gray-500 max-w-xs leading-relaxed">
            Your payment proof has been submitted. The creditor will review it
            and update the balance once confirmed.
          </p>
          <p className="text-xs text-gray-400">Status: <strong className="text-amber-600">Pending Review</strong></p>
        </div>
      </div>
    );
  }

  const expiryLabel = req?.expires_at
    ? timeUntilExpiry(req.expires_at)
    : req?.access_type === "once"
    ? "Single use"
    : "No expiry";

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Header />
      <div className="px-5 py-5 flex flex-col gap-5 pb-8">
        {/* Approval badge */}
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
          <CheckCircle2 className="w-4 h-4 text-[#009966] shrink-0" />
          <p className="text-sm font-bold text-emerald-800">
            Access Approved — {expiryLabel}
          </p>
        </div>

        {/* Case summary */}
        <CaseSummary c={c} />

        {/* Payment reference */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">
            Payment Reference
          </p>
          <div className="bg-[#F2F4F7] rounded-2xl p-4 flex items-center justify-between">
            <p className="text-xl font-black text-[#0D1B3D] font-mono tracking-wide">{c.id}</p>
            <CopyBtn value={c.id} />
          </div>
          <p className="text-[11px] text-red-500 mt-1.5 ml-1 font-medium">
            ⚠️ Include this reference so your payment can be matched correctly.
          </p>
        </div>

        {/* Bank transfer */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border-b border-amber-100">
            <Building2 className="w-4 h-4 text-amber-600" />
            <p className="text-sm font-bold text-amber-800">Bank Transfer</p>
            <span className="ml-auto text-xs font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
              {acct.bank_name}
            </span>
          </div>
          <div className="px-4 py-3 flex flex-col gap-3">
            <BankRow label="Bank"           value={acct.bank_name} />
            <BankRow label="Account Name"   value={acct.account_holder_name}  copyable />
            <BankRow label="Account Number" value={acct.account_number} copyable />
          </div>
        </div>

        {/* DuitNow */}
        {acct.duitnow_id && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50 border-b border-emerald-100">
              <QrCode className="w-4 h-4 text-[#009966]" />
              <p className="text-sm font-bold text-emerald-800">DuitNow</p>
            </div>
            <div className="px-4 py-4 flex gap-4 items-center">
              <div className="w-24 h-24 border-2 border-dashed border-[#009966]/30 rounded-xl flex items-center justify-center shrink-0 bg-[#F2F4F7]">
                <QrCode className="w-10 h-10 text-[#009966]/40" />
              </div>
              <div>
                <p className="text-[11px] text-gray-400 mb-1">DuitNow ID</p>
                <p className="text-sm font-bold text-gray-800 font-mono">{acct.duitnow_id}</p>
                <CopyBtn value={acct.duitnow_id} label />
              </div>
            </div>
          </div>
        )}

        {/* Expiry */}
        {req?.expires_at && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Clock className="w-3.5 h-3.5 text-amber-500" />
            <span>Access: <strong className="text-gray-700">{timeUntilExpiry(req.expires_at)}</strong></span>
          </div>
        )}

        {/* Disclaimer */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 leading-relaxed">
            <strong>Important:</strong> Include the payment reference so your payment
            can be matched correctly. Do not share these details with others.
          </p>
        </div>

        {/* CTAs */}
        <div className="flex flex-col gap-2">
          <PrimaryButton fullWidth size="lg" onClick={() => setMadePayment(true)}>
            I&apos;ve Made Payment &amp; Submit Proof
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

// ─── Form field ───────────────────────────────────────────────────────────────

function FormField({ label, placeholder, value, onChange, type = "text" }: {
  label: string; placeholder: string; value: string;
  onChange: (v: string) => void; type?: string;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-600 mb-1 block">{label}</label>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-800 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300"
      />
    </div>
  );
}

// ─── Bank row ─────────────────────────────────────────────────────────────────

function BankRow({ label, value, copyable }: { label: string; value: string; copyable?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-[11px] text-gray-400">{label}</p>
        <p className="text-sm font-semibold text-gray-800 mt-0.5">{value}</p>
      </div>
      {copyable && <CopyBtn value={value} />}
    </div>
  );
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyBtn({ value, label }: { value: string; label?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="flex items-center gap-1 text-xs font-semibold text-[#009966] hover:text-emerald-700"
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {label && <span>{copied ? "Copied" : "Copy"}</span>}
    </button>
  );
}
