"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSpinner, InlineSpinner } from "@/components/ui/loading-spinner";
import { usePayments } from "@/hooks/use-payments";
import { usePaymentProofs } from "@/hooks/use-payment-proofs";
import { useBusinessId } from "@/hooks/use-business-id";
import { appendAuditLogClient } from "@/lib/db/audit-logs-client";
import { track } from "@/lib/analytics/tracker";
import {
  PAYMENT_METHOD_LABELS,
  REVIEW_STATUS_CONFIG,
} from "@/lib/db/payments-client";
import { type PaymentRow } from "@/lib/supabase/types";
import type { PaymentProofDecision, PaymentProofSubmission } from "@/lib/payment-proofs/client";
import { formatRM } from "@/lib/mock-data";
import {
  CreditCard, Clock, CheckCircle2, XCircle,
  Settings, Inbox, ShieldCheck, AlertCircle, AlertTriangle,
  FileSpreadsheet,
} from "lucide-react";

export function PaymentHistoryPage() {
  const { payments, loading, error, approve, reject, markUnmatched, refresh } = usePayments();
  const { submissions, loading: proofsLoading, error: proofsError, review: reviewProof } = usePaymentProofs();
  const businessId = useBusinessId();

  const totalPaid      = payments.filter((p) => p.review_status === "approved").reduce((s, p) => s + p.amount, 0);
  const pendingReview  = payments.filter((p) => p.review_status === "pending_review");
  const approved       = payments.filter((p) => p.review_status === "approved");
  const others         = payments.filter((p) => p.review_status === "rejected" || p.review_status === "unmatched");
  const proofQueue = submissions.filter((item) => ["submitted", "under_review", "more_information_required", "pending_review"].includes(item.status));

  async function handleProofReview(submission: PaymentProofSubmission, decision: PaymentProofDecision) {
    let reason: string | undefined;
    if (decision === "rejected" || decision === "more_information_required") {
      const entered = window.prompt(decision === "rejected" ? "Reason for rejection (required)" : "What information is required?");
      if (entered === null) return;
      reason = entered.trim();
      if (reason.length < 3) return;
    }
    const result = await reviewProof(submission.id, decision, reason);
    if (result.error) window.alert(result.error);
    if (!result.error && decision === "confirmed") await refresh();
  }

  async function handleApprove(p: PaymentRow) {
    const { error: err } = await approve(p.id);
    if (!err) {
      await appendAuditLogClient({
        business_id: businessId ?? "mock-business-id",
        case_id: p.case_id,
        action: "payment.approved", actor_type: "owner",
        metadata: { payment_id: p.id, amount: p.amount },
      });
      track("payment_approved", { case_id: p.case_id });
    }
  }

  async function handleReject(p: PaymentRow) {
    const { error: err } = await reject(p.id);
    if (!err) {
      await appendAuditLogClient({
        business_id: businessId ?? "mock-business-id",
        case_id: p.case_id,
        action: "payment.rejected", actor_type: "owner",
        metadata: { payment_id: p.id, amount: p.amount },
      });
    }
  }

  async function handleUnmatched(p: PaymentRow) {
    await markUnmatched(p.id);
  }

  return (
    <div className="cb-light-surface flex flex-col pb-6">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-[#0D1B3D]">Payments</h1>
            <p className="text-xs text-gray-400 mt-0.5">Track all payments and proof reviews.</p>
          </div>
          <Link href="/payments/account" className="w-8 h-8 flex items-center justify-center rounded-xl bg-gray-100 hover:bg-gray-200 transition-colors">
            <Settings className="w-4 h-4 text-gray-500" />
          </Link>
        </div>
      </div>

      <div className="px-4 pt-5 flex flex-col gap-5">
        {/* Summary hero */}
        <div className="bg-[#0D1B3D] rounded-2xl p-5">
          <p className="text-blue-200 text-xs font-medium mb-1">Total Approved Payments</p>
          <p className="text-3xl font-black text-white tracking-tight">{formatRM(totalPaid)}</p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="bg-amber-500/20 rounded-xl p-2">
              <p className="text-amber-200 text-[10px] font-medium">Pending</p>
              <p className="text-white text-lg font-black">{pendingReview.length}</p>
            </div>
            <div className="bg-emerald-500/20 rounded-xl p-2">
              <p className="text-emerald-200 text-[10px] font-medium">Approved</p>
              <p className="text-white text-lg font-black">{approved.length}</p>
            </div>
            <div className="bg-red-500/20 rounded-xl p-2">
              <p className="text-red-200 text-[10px] font-medium">Rejected</p>
              <p className="text-white text-lg font-black">{others.length}</p>
            </div>
          </div>
        </div>

        {/* Quick links */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <QuickLink href="/payments/requests" icon={<Inbox className="w-4 h-4" />} label="Access Queue"
            badge={proofQueue.length > 0 ? proofQueue.length : undefined} />
          <QuickLink href="/payments/account" icon={<CreditCard className="w-4 h-4" />} label="Accounts" />
          <QuickLink href="/statements" icon={<FileSpreadsheet className="w-4 h-4" />} label="Statements" />
          <QuickLink href="/cases" icon={<ShieldCheck className="w-4 h-4" />} label="All Cases" />
        </div>

        {/* Help tip: what is payment lock? */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex gap-3">
          <ShieldCheck className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-blue-800">How payments work</p>
            <p className="text-[11px] text-blue-700 mt-0.5 leading-relaxed">
              Debtors submit payment proof via their link. You review and approve — only
              then is the case balance updated. Enable <strong>Payment Lock</strong> on each
              case to control access.
            </p>
          </div>
        </div>

        {loading ? (
          <LoadingSpinner />
        ) : error ? (
          <div className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-xl p-3">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        ) : (
          <>
            {/* Pending review — with action buttons */}
            {(proofsLoading || proofsError || proofQueue.length > 0) && (
              <SectionCard title={`Payment Proof Review (${proofQueue.length})`}>
                {proofsLoading ? <LoadingSpinner /> : proofsError ? (
                  <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">{proofsError}</div>
                ) : (
                  <div className="mt-2 flex flex-col gap-3">
                    {proofQueue.map((submission) => (
                      <PaymentProofCard key={submission.id} submission={submission} onReview={(decision) => handleProofReview(submission, decision)} />
                    ))}
                  </div>
                )}
              </SectionCard>
            )}

            {pendingReview.length > 0 && (
              <SectionCard title={`Pending Review (${pendingReview.length})`}>
                <div className="flex flex-col gap-3 mt-2">
                  <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex gap-2">
                    <Clock className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700">
                      Verify each proof before approving. Approved payments update the case balance.
                    </p>
                  </div>
                  {pendingReview.map((p) => (
                    <PendingPaymentCard
                      key={p.id}
                      payment={p}
                      onApprove={() => handleApprove(p)}
                      onReject={() => handleReject(p)}
                      onUnmatched={() => handleUnmatched(p)}
                    />
                  ))}
                </div>
              </SectionCard>
            )}

            {/* Approved */}
            {approved.length > 0 && (
              <SectionCard title="Confirmed Payments">
                <div className="flex flex-col mt-1">
                  {approved.map((p, i) => (
                    <PaymentRow key={p.id} payment={p} isLast={i === approved.length - 1} />
                  ))}
                </div>
              </SectionCard>
            )}

            {/* Rejected / unmatched */}
            {others.length > 0 && (
              <SectionCard title="Needs Attention">
                <div className="flex flex-col mt-1">
                  {others.map((p, i) => (
                    <PaymentRow key={p.id} payment={p} isLast={i === others.length - 1} />
                  ))}
                </div>
              </SectionCard>
            )}

            {payments.length === 0 && (
              <EmptyState
                icon={<CreditCard className="w-6 h-6" />}
                title="No payments recorded"
                description="When you record payments from debtors, they will appear here."
              />
            )}
          </>
        )}

        <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex gap-2">
          <ShieldCheck className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
          <p className="text-[11px] text-blue-700 leading-relaxed">
            All payments require manual proof review before a case is marked as paid.
            Never confirm without verifying proof.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Pending payment card (with inline actions) ───────────────────────────────

function PaymentProofCard({ submission, onReview }: { submission: PaymentProofSubmission; onReview: (decision: PaymentProofDecision) => Promise<void> }) {
  const [acting, setActing] = useState<PaymentProofDecision | null>(null);
  async function act(decision: PaymentProofDecision) {
    setActing(decision);
    await onReview(decision);
    setActing(null);
  }
  return (
    <article className="overflow-hidden rounded-2xl border border-amber-200 bg-white">
      <div className="space-y-1 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs font-bold text-gray-700">{submission.case_id}</p>
            <p className="text-[11px] text-gray-500">{PAYMENT_METHOD_LABELS[submission.payment_method]} · Paid {submission.payment_date}</p>
            {submission.reference_no && <p className="text-[11px] text-gray-500">Reference: {submission.reference_no}</p>}
          </div>
          <p className="shrink-0 text-base font-black text-gray-900">{formatRM(submission.amount)}</p>
        </div>
        {submission.debtor_note && <p className="text-[11px] italic text-gray-500">&ldquo;{submission.debtor_note}&rdquo;</p>}
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold uppercase text-amber-700">{submission.status.replaceAll("_", " ")}</span>
          {submission.proofUrl && <a href={submission.proofUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-[#009966] hover:underline">View Payment Proof</a>}
        </div>
        {submission.rejection_reason && <p className="rounded-lg bg-red-50 px-2 py-1.5 text-[11px] text-red-700">Reason: {submission.rejection_reason}</p>}
        {submission.events.length > 0 && (
          <ol className="mt-2 border-l-2 border-gray-100 pl-3" aria-label="Payment proof timeline">
            {submission.events.map((event) => (
              <li key={event.id} className="pb-1 text-[10px] text-gray-500">
                <strong className="capitalize text-gray-700">{event.to_status.replaceAll("_", " ")}</strong>
                {` · ${new Date(event.created_at).toLocaleString("en-MY", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
                {event.reason && <span className="block">{event.reason}</span>}
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-gray-100 p-3 sm:grid-cols-4">
        <ProofAction disabled={!!acting} label="Under Review" onClick={() => act("under_review")} />
        <ProofAction disabled={!!acting} label="Need Info" onClick={() => act("more_information_required")} />
        <ProofAction disabled={!!acting} label="Reject" danger onClick={() => act("rejected")} />
        <ProofAction disabled={!!acting} label="Confirm" primary onClick={() => act("confirmed")} />
      </div>
    </article>
  );
}

function ProofAction({ label, onClick, disabled, primary, danger }: { label: string; onClick: () => void; disabled: boolean; primary?: boolean; danger?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className={cn("min-h-10 rounded-xl border px-2 py-2 text-[11px] font-bold disabled:opacity-50", primary ? "border-emerald-500 bg-emerald-500 text-white" : danger ? "border-red-200 text-red-600" : "border-gray-200 text-gray-600")}>{label}</button>;
}

function PendingPaymentCard({
  payment: p, onApprove, onReject, onUnmatched,
}: {
  payment:     PaymentRow;
  onApprove:   () => void;
  onReject:    () => void;
  onUnmatched: () => void;
}) {
  const [acting, setActing] = useState<string | null>(null);
  const createdAt = new Date(p.created_at).toLocaleString("en-MY", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });

  async function handle(key: string, fn: () => void) {
    setActing(key);
    await fn();
    setActing(null);
  }

  return (
    <div className="bg-white rounded-2xl border border-amber-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-50">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-mono text-gray-500">{p.case_id.slice(-12)}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {PAYMENT_METHOD_LABELS[p.payment_method]}
              {p.reference_no && ` · Ref: ${p.reference_no}`}
            </p>
            <p className="text-[10px] text-gray-400">{createdAt}</p>
          </div>
          <p className="text-base font-black text-gray-900 shrink-0">{formatRM(p.amount)}</p>
        </div>
        {p.notes && <p className="text-[11px] text-gray-500 mt-1 italic">&ldquo;{p.notes}&rdquo;</p>}
        {p.proof_url && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            <p className="text-[11px] text-emerald-700 font-semibold">Proof uploaded</p>
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-1.5 px-3 py-2.5">
        <button
          onClick={() => handle("approve", onApprove)}
          disabled={!!acting}
          className="flex min-h-11 items-center justify-center gap-1 rounded-xl bg-emerald-500 py-2 text-xs font-bold text-white transition-all hover:bg-emerald-600 disabled:opacity-60"
        >
          {acting === "approve" ? <InlineSpinner className="text-white" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          Approve
        </button>
        <button
          onClick={() => handle("reject", onReject)}
          disabled={!!acting}
          className="flex min-h-11 items-center justify-center gap-1 rounded-xl border border-red-200 py-2 text-xs font-bold text-red-600 transition-all hover:bg-red-50 disabled:opacity-60"
        >
          {acting === "reject" ? <InlineSpinner className="text-red-600" /> : <XCircle className="w-3.5 h-3.5" />}
          Reject
        </button>
        <button
          onClick={() => handle("unmatched", onUnmatched)}
          disabled={!!acting}
          className="flex min-h-11 items-center justify-center gap-1 rounded-xl border border-gray-200 py-2 text-xs font-bold text-gray-500 transition-all hover:bg-gray-50 disabled:opacity-60"
        >
          {acting === "unmatched" ? <InlineSpinner className="text-gray-500" /> : <AlertTriangle className="w-3.5 h-3.5" />}
          Unmatch
        </button>
      </div>
      <div className="px-4 pb-2 flex justify-end">
        <Link href={`/cases/${p.case_id}`} className="text-[11px] text-[#009966] font-semibold hover:underline">
          View Case →
        </Link>
      </div>
    </div>
  );
}

// ─── Regular payment row ──────────────────────────────────────────────────────

function PaymentRow({ payment: p, isLast }: { payment: PaymentRow; isLast: boolean }) {
  const cfg = REVIEW_STATUS_CONFIG[p.review_status];
  const createdAt = new Date(p.created_at).toLocaleDateString("en-MY", {
    day: "numeric", month: "short",
  });

  return (
    <div className={cn("flex items-start gap-3 py-3.5", !isLast && "border-b border-gray-50")}>
      <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0", cfg.bg)}>
        {p.review_status === "approved"
          ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          : p.review_status === "pending_review"
          ? <Clock className="w-4 h-4 text-amber-500" />
          : <XCircle className="w-4 h-4 text-red-400" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-gray-700 font-mono">{p.case_id.slice(-12)}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          {PAYMENT_METHOD_LABELS[p.payment_method]}
          {p.reference_no && ` · ${p.reference_no}`}
        </p>
        <p className="text-[11px] text-gray-400">{createdAt}</p>
        {p.notes && <p className="text-[11px] text-gray-500 mt-0.5 italic">{p.notes}</p>}
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-black text-gray-900">{formatRM(p.amount)}</p>
        <span className={cn("inline-block mt-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full border", cfg.bg, cfg.color, cfg.border)}>
          {cfg.label}
        </span>
      </div>
    </div>
  );
}

// ─── Quick link chip ──────────────────────────────────────────────────────────

function QuickLink({ href, icon, label, badge }: {
  href: string; icon: React.ReactNode; label: string; badge?: number;
}) {
  return (
    <Link href={href} className="flex flex-col items-center gap-1.5 py-3 bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all relative">
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-amber-500 text-white text-[10px] font-black rounded-full flex items-center justify-center">
          {badge}
        </span>
      )}
      <div className="text-[#009966]">{icon}</div>
      <p className="text-[10px] font-semibold text-gray-600 text-center leading-tight">{label}</p>
    </Link>
  );
}
