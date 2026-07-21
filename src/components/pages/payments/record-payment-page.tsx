"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SectionCard } from "@/components/ui/section-card";
import { LoadingSpinner, InlineSpinner } from "@/components/ui/loading-spinner";
import { useCase } from "@/hooks/use-case";
import { useBusinessId } from "@/hooks/use-business-id";
import { createPaymentClient, PAYMENT_METHOD_LABELS, PAYMENT_METHOD_ICONS } from "@/lib/db/payments-client";
import { appendAuditLogClient } from "@/lib/db/audit-logs-client";
import { type PaymentMethod, type PaymentReviewStatus } from "@/lib/supabase/types";
import { formatRM } from "@/lib/mock-data";
import {
  ChevronLeft, DollarSign, Hash, FileText, Upload,
  CheckCircle2, AlertCircle, Info, Loader2,
} from "lucide-react";

const METHODS: PaymentMethod[] = ["duitnow_qr", "bank_transfer", "cash", "cheque", "tng_ewallet"];

interface Props {
  caseId: string;
}

export function RecordPaymentPage({ caseId }: Props) {
  const { caseData, loading: caseLoading } = useCase(caseId);
  const businessId = useBusinessId();

  const [amount,       setAmount]       = useState("");
  const [method,       setMethod]       = useState<PaymentMethod>("duitnow_qr");
  const [reference,    setReference]    = useState(caseId);
  const [notes,        setNotes]        = useState("");
  const [saveApproved, setSaveApproved] = useState(false);
  const [proofFile,    setProofFile]    = useState<File | null>(null);
  const [proofProgress, setProofProgress] = useState(0);
  const [uploading,    setUploading]    = useState(false);
  const [submitting,   setSubmitting]   = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [submitted,    setSubmitted]    = useState<{ amount: number; method: PaymentMethod; reference: string; status: PaymentReviewStatus } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  if (caseLoading) return <LoadingSpinner />;
  if (!caseData) {
    return (
      <div className="px-4 py-16 flex flex-col items-center gap-4">
        <AlertCircle className="w-8 h-8 text-red-400" />
        <p className="text-sm font-semibold text-gray-700">Case not found</p>
        <Link href="/cases" className="text-sm text-[#009966] font-semibold">← Back to Cases</Link>
      </div>
    );
  }

  const c          = caseData;
  const amountNum  = parseFloat(amount) || 0;
  const isValid    = amountNum > 0;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError("File is too large. Max 10 MB."); return; }
    const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
    if (![".pdf",".png",".jpg",".jpeg"].includes(ext)) { setError("Only PDF, PNG, JPG allowed."); return; }
    setProofFile(file);
    setError(null);
    e.target.value = "";
  }

  async function handleSubmit() {
    if (!isValid) return;
    setSubmitting(true);
    setError(null);

    const bId = businessId ?? "mock-business-id";
    let proofUrl: string | null = null;

    if (proofFile) {
      setUploading(true);
      setProofProgress(20);
      const form = new FormData();
      form.set("file", proofFile);
      form.set("evidenceType", "payment_proof");
      form.set("description", "Payment receipt uploaded while recording payment.");
      const upload = await fetch(`/api/cases/${encodeURIComponent(c.id)}/evidence`, {
        method: "POST",
        body: form,
      });
      const uploadBody = await upload.json().catch(() => null) as { error?: string; file?: { object_path?: string } } | null;
      proofUrl = upload.ok ? uploadBody?.file?.object_path ?? null : null;
      setProofProgress(proofUrl ? 100 : 0);
      setUploading(false);
      if (!proofUrl) { setError(uploadBody?.error ?? "Proof upload failed. Try again."); setSubmitting(false); return; }
    }

    const status: PaymentReviewStatus = saveApproved ? "approved" : "pending_review";

    const result = await createPaymentClient({
      case_id:        c.id,
      amount,
      payment_method: method,
      reference_no:   reference.trim() || null,
      proof_url:      proofUrl,
      review_status:  status,
      notes:          notes.trim() || null,
    });

    if (result.error) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    await appendAuditLogClient({
      business_id: bId,
      case_id:     c.id,
      action:      "payment.recorded",
      actor_type:  "owner",
      metadata:    { amount: amountNum, method, reference, status, payment_id: result.data!.id },
    });

    if (status === "approved") {
      await appendAuditLogClient({
        business_id: bId, case_id: c.id,
        action: "payment.approved", actor_type: "owner",
        metadata: { payment_id: result.data!.id, amount: amountNum },
      });
    }

    setSubmitted({ amount: amountNum, method, reference, status });
    setSubmitting(false);
  }

  if (submitted) {
    return <Confirmation caseData={c} submitted={submitted} />;
  }

  return (
    <div className="flex flex-col pb-6">
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-2 mb-1">
          <Link href={`/cases/${c.id}`} className="text-gray-400 hover:text-gray-600">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-lg font-bold text-[#0D1B3D]">Record Payment</h1>
        </div>
        <p className="text-xs text-gray-400 ml-7">Manually record a payment from this debtor.</p>
      </div>

      <div className="px-4 pt-5 flex flex-col gap-5">
        {/* Case summary */}
        <div className="bg-[#0D1B3D] rounded-2xl p-4 flex items-center justify-between">
          <div>
            <p className="text-blue-200 text-xs font-semibold truncate max-w-[180px]">{c.debtor_name}</p>
            <p className="text-[11px] text-blue-300 mt-0.5 font-mono">{c.id}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-blue-200">Balance Due</p>
            <p className="text-lg font-black text-white">{formatRM(c.balance)}</p>
          </div>
        </div>

        {/* Amount */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-bold text-gray-700">Amount Received (RM) *</label>
          <div className="relative">
            <DollarSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="number" min="0.01" step="0.01" placeholder="0.00"
              value={amount} onChange={(e) => setAmount(e.target.value)}
              className="w-full pl-10 pr-4 py-3.5 bg-white border border-gray-200 rounded-xl text-lg font-black text-gray-900 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition-all"
            />
          </div>
          {amountNum > 0 && amountNum < c.balance && (
            <p className="text-xs text-amber-600 ml-1">
              Partial — remaining balance: {formatRM(c.balance - amountNum)}
            </p>
          )}
          {amountNum >= c.balance && amountNum > 0 && (
            <p className="text-xs text-emerald-600 ml-1 font-semibold">✓ Covers full balance</p>
          )}
        </div>

        {/* Method */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-bold text-gray-700">Payment Method</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {METHODS.map((m) => (
              <button
                key={m}
                onClick={() => setMethod(m)}
                className={cn(
                  "flex flex-col items-center gap-1 py-3 px-2 rounded-xl border-2 text-center text-xs font-semibold transition-all",
                  method === m
                    ? "border-[#009966] bg-emerald-50 text-[#009966]"
                    : "border-gray-100 bg-white text-gray-500 hover:border-gray-200"
                )}
              >
                <span className="text-lg">{PAYMENT_METHOD_ICONS[m]}</span>
                {PAYMENT_METHOD_LABELS[m]}
              </button>
            ))}
          </div>
        </div>

        {/* Reference */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-bold text-gray-700">Payment Reference</label>
          <div className="relative">
            <Hash className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text" value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="w-full pl-10 pr-4 py-3.5 bg-white border border-gray-200 rounded-xl text-sm font-mono text-gray-900 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition-all"
            />
          </div>
          <p className="text-[11px] text-gray-400 ml-1">Reference the debtor used when paying.</p>
        </div>

        {/* Payment date */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-bold text-gray-700">Payment Date</label>
          <input
            type="date" defaultValue={new Date().toISOString().split("T")[0]}
            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition-all"
          />
        </div>

        {/* Proof upload */}
        <SectionCard title="Payment Proof">
          <div className="mt-2">
            <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" onChange={handleFileChange} />
            <button
              onClick={() => fileRef.current?.click()}
              className={cn(
                "w-full flex flex-col items-center gap-2 py-5 border-2 border-dashed rounded-xl transition-colors",
                proofFile ? "border-[#009966] bg-emerald-50" : "border-gray-200 hover:border-emerald-300 bg-white"
              )}
            >
              {proofFile ? (
                <>
                  <CheckCircle2 className="w-7 h-7 text-[#009966]" />
                  <p className="text-sm font-bold text-[#009966]">Proof Selected</p>
                  <p className="text-xs text-emerald-600 truncate max-w-[200px]">{proofFile.name}</p>
                </>
              ) : (
                <>
                  <Upload className="w-7 h-7 text-gray-300" />
                  <p className="text-sm font-semibold text-gray-500">Upload Receipt (Optional)</p>
                  <p className="text-xs text-gray-400">PDF, PNG or JPG · max 10 MB</p>
                </>
              )}
            </button>

            {uploading && (
              <div className="mt-2">
                <div className="flex items-center gap-2 mb-1">
                  <Loader2 className="w-3 h-3 text-[#009966] animate-spin" />
                  <p className="text-[11px] text-[#009966] font-semibold">Uploading… {proofProgress}%</p>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div className="bg-[#009966] h-1.5 rounded-full transition-all" style={{ width: `${proofProgress}%` }} />
                </div>
              </div>
            )}
          </div>
        </SectionCard>

        {/* Notes */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-bold text-gray-700">
            Notes <span className="text-gray-400 font-normal">(Optional)</span>
          </label>
          <div className="relative">
            <FileText className="absolute left-3.5 top-3.5 w-4 h-4 text-gray-400" />
            <textarea
              placeholder="e.g. Partial payment, balance due next week"
              value={notes} onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition-all resize-none"
            />
          </div>
        </div>

        {/* Approval mode toggle */}
        <div className={cn(
          "rounded-xl border-2 p-3.5 flex items-center gap-3 cursor-pointer transition-all",
          saveApproved ? "border-[#009966] bg-emerald-50" : "border-gray-200 bg-white"
        )}
          onClick={() => setSaveApproved((v) => !v)}
        >
          <div className={cn(
            "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all",
            saveApproved ? "border-[#009966] bg-[#009966]" : "border-gray-300"
          )}>
            {saveApproved && <div className="w-2 h-2 bg-white rounded-full" />}
          </div>
          <div>
            <p className={cn("text-sm font-bold", saveApproved ? "text-[#009966]" : "text-gray-700")}>
              Save as Approved Payment
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Immediately update case balance. Only check this if you have verified the payment.
            </p>
          </div>
        </div>

        {!saveApproved && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-800 leading-relaxed">
              Payment will be set to <strong>Pending Review</strong>. The case balance will only
              update after you approve from the Payment Review Queue.
            </p>
          </div>
        )}

        {saveApproved && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex gap-2.5">
            <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-blue-700 leading-relaxed">
              <strong>Approved payment</strong> — case balance will be updated immediately.
              Only use this if you have already confirmed the payment is legitimate.
            </p>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
            <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        <PrimaryButton
          fullWidth size="lg" disabled={!isValid || submitting}
          onClick={handleSubmit}
          icon={submitting ? <InlineSpinner className="text-white" /> : undefined}
        >
          {submitting ? "Saving…" : saveApproved ? "Save Approved Payment" : "Submit for Review"}
        </PrimaryButton>
      </div>
    </div>
  );
}

// ─── Confirmation ─────────────────────────────────────────────────────────────

function Confirmation({
  caseData: c,
  submitted: s,
}: {
  caseData: import("@/lib/supabase/types").CaseRow;
  submitted: { amount: number; method: PaymentMethod; reference: string; status: PaymentReviewStatus };
}) {
  const isApproved = s.status === "approved";
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className={cn("w-16 h-16 rounded-full flex items-center justify-center mb-4",
        isApproved ? "bg-emerald-100" : "bg-amber-50"
      )}>
        <CheckCircle2 className={cn("w-8 h-8", isApproved ? "text-[#009966]" : "text-amber-500")} />
      </div>
      <h2 className="text-lg font-black text-[#0D1B3D]">Payment Recorded</h2>
      <p className="text-sm text-gray-500 mt-1.5">
        Status: <span className={cn("font-bold", isApproved ? "text-emerald-600" : "text-amber-600")}>
          {isApproved ? "Approved" : "Pending Review"}
        </span>
      </p>

      <div className="mt-5 bg-[#F2F4F7] rounded-2xl p-4 w-full text-left flex flex-col gap-2.5">
        {[
          { label: "Debtor",    value: c.debtor_name },
          { label: "Amount",    value: formatRM(s.amount) },
          { label: "Method",    value: PAYMENT_METHOD_LABELS[s.method] },
          { label: "Reference", value: s.reference },
          { label: "Status",    value: isApproved ? "Approved" : "Pending Review" },
        ].map((row) => (
          <div key={row.label} className="flex items-center justify-between">
            <span className="text-xs text-gray-400">{row.label}</span>
            <span className="text-sm font-bold text-gray-800">{row.value}</span>
          </div>
        ))}
      </div>

      {!isApproved && (
        <p className="text-xs text-gray-400 mt-4 leading-relaxed">
          Balance will update after you review and approve the proof in the Payments queue.
        </p>
      )}

      <div className="mt-6 w-full flex flex-col gap-2">
        <Link href={`/cases/${c.id}`}>
          <PrimaryButton fullWidth>View Case</PrimaryButton>
        </Link>
        <Link href="/payments">
          <PrimaryButton fullWidth variant="ghost">Payment History</PrimaryButton>
        </Link>
      </div>
    </div>
  );
}
