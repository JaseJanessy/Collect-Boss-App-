"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SectionCard } from "@/components/ui/section-card";
import { LoadingSpinner, InlineSpinner } from "@/components/ui/loading-spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { usePaymentRequests } from "@/hooks/use-payment-requests";
import { useBusinessId } from "@/hooks/use-business-id";
import { appendAuditLogClient } from "@/lib/db/audit-logs-client";
import { formatRM } from "@/lib/mock-data";
import { type PaymentAccessRequestRow, type AccessType } from "@/lib/supabase/types";
import {
  ChevronLeft, Clock, CheckCircle2, XCircle, Inbox,
  ChevronRight, Phone, ShieldCheck, Send, AlertCircle,
} from "lucide-react";

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; dot: string; color: string }> = {
  pending:       { label: "Pending",       dot: "bg-amber-400",   color: "text-amber-700" },
  approved:      { label: "Approved",      dot: "bg-emerald-500", color: "text-emerald-700" },
  rejected:      { label: "Rejected",      dot: "bg-red-400",     color: "text-red-600" },
  expired:       { label: "Expired",       dot: "bg-gray-400",    color: "text-gray-500" },
  sent_manually: { label: "Sent Manually", dot: "bg-blue-400",    color: "text-blue-700" },
};

// ─── Main ─────────────────────────────────────────────────────────────────────

export function PaymentRequestsPage() {
  const { requests, loading, error, approve, reject, markManual } = usePaymentRequests();
  const businessId = useBusinessId();

  const pending = requests.filter((r) => r.status === "pending");
  const others  = requests.filter((r) => r.status !== "pending");

  const stats = {
    pending:  requests.filter((r) => r.status === "pending").length,
    approved: requests.filter((r) => r.status === "approved").length,
    rejected: requests.filter((r) => r.status === "rejected").length,
  };

  async function handleApprove(r: PaymentAccessRequestRow, type: AccessType) {
    const { error: err } = await approve(r.id, type);
    if (!err) {
      await appendAuditLogClient({
        business_id: businessId ?? "mock-business-id",
        case_id:     r.case_id,
        action:      "payment_access.approved",
        actor_type:  "owner",
        metadata:    { request_id: r.id, access_type: type, requester: r.requester_name },
      });
    }
  }

  async function handleReject(r: PaymentAccessRequestRow) {
    const { error: err } = await reject(r.id);
    if (!err) {
      await appendAuditLogClient({
        business_id: businessId ?? "mock-business-id",
        case_id:     r.case_id,
        action:      "payment_access.rejected",
        actor_type:  "owner",
        metadata:    { request_id: r.id, requester: r.requester_name },
      });
    }
  }

  async function handleManual(r: PaymentAccessRequestRow) {
    const { error: err } = await markManual(r.id);
    if (!err) {
      await appendAuditLogClient({
        business_id: businessId ?? "mock-business-id",
        case_id:     r.case_id,
        action:      "payment_access.sent_manually",
        actor_type:  "owner",
        metadata:    { request_id: r.id, requester: r.requester_name },
      });
    }
  }

  return (
    <div className="flex flex-col pb-6">
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/payments" className="text-gray-400 hover:text-gray-600">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-lg font-bold text-[#0D1B3D]">Payment Access Queue</h1>
        </div>
        <p className="text-xs text-gray-400 ml-7">
          Review and approve debtor payment detail requests.
        </p>
      </div>

      <div className="px-4 pt-5 flex flex-col gap-5">
        {/* Stats strip */}
        <div className="grid grid-cols-3 gap-3">
          <StatChip icon={<Clock className="w-4 h-4 text-amber-500" />}      label="Pending"  value={stats.pending}  bg="bg-amber-50" />
          <StatChip icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />} label="Approved" value={stats.approved} bg="bg-emerald-50" />
          <StatChip icon={<XCircle className="w-4 h-4 text-red-400" />}      label="Rejected" value={stats.rejected} bg="bg-red-50" />
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
            {/* Pending — with inline action buttons */}
            {pending.length > 0 && (
              <SectionCard title={`Needs Your Action (${pending.length})`}>
                <div className="flex flex-col gap-3 mt-2">
                  {pending.map((req) => (
                    <PendingRequestCard
                      key={req.id}
                      req={req}
                      onApproveOnce={() => handleApprove(req, "once")}
                      onApprove24h={() => handleApprove(req, "24h")}
                      onReject={() => handleReject(req)}
                      onManual={() => handleManual(req)}
                    />
                  ))}
                </div>
              </SectionCard>
            )}

            {/* History */}
            {others.length > 0 && (
              <SectionCard title="Recent History">
                <div className="flex flex-col mt-1">
                  {others.map((req, i) => (
                    <HistoryRow key={req.id} req={req} isLast={i === others.length - 1} />
                  ))}
                </div>
              </SectionCard>
            )}

            {requests.length === 0 && (
              <EmptyState
                icon={<Inbox className="w-6 h-6" />}
                title="No requests yet"
                description="When debtors request payment details, they'll appear here."
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Pending request card (with inline action buttons) ────────────────────────

function PendingRequestCard({
  req,
  onApproveOnce,
  onApprove24h,
  onReject,
  onManual,
}: {
  req:          PaymentAccessRequestRow;
  onApproveOnce: () => void;
  onApprove24h:  () => void;
  onReject:      () => void;
  onManual:      () => void;
}) {
  const [acting, setActing] = useState<string | null>(null);

  async function handle(key: string, fn: () => void) {
    setActing(key);
    await fn();
    setActing(null);
  }

  const requestedAt = new Date(req.created_at).toLocaleString("en-MY", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
      {/* Requester info */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-50">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#0D1B3D] flex items-center justify-center text-white text-sm font-bold shrink-0">
            {req.requester_name.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-bold text-gray-900">{req.requester_name}</p>
              {req.otp_verified && (
                <span className="flex items-center gap-0.5 text-[9px] font-bold text-[#009966] bg-emerald-50 px-1.5 py-0.5 rounded-full border border-emerald-100">
                  <ShieldCheck className="w-2.5 h-2.5" /> OTP
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 text-[11px] text-gray-400 mt-0.5">
              <Phone className="w-3 h-3" />
              {req.requester_phone}
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] text-gray-400">Case</p>
            <p className="text-xs font-mono font-bold text-gray-700">{req.case_id.slice(-8)}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {req.preferred_method && (
            <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-100 px-1.5 py-0.5 rounded-full font-semibold">
              {req.preferred_method}
            </span>
          )}
          {req.reason && (
            <p className="text-[11px] text-gray-500 italic">&ldquo;{req.reason}&rdquo;</p>
          )}
        </div>
        <p className="text-[10px] text-gray-400 mt-1">{requestedAt}</p>
      </div>

      {/* Action buttons */}
      <div className="px-3 py-3 grid grid-cols-2 gap-2">
        <ActionBtn
          color="bg-emerald-500 hover:bg-emerald-600 text-white"
          label="Approve Once"
          busy={acting === "once"}
          icon={<CheckCircle2 className="w-3.5 h-3.5" />}
          onClick={() => handle("once", onApproveOnce)}
        />
        <ActionBtn
          color="bg-blue-500 hover:bg-blue-600 text-white"
          label="Approve 24h"
          busy={acting === "24h"}
          icon={<Clock className="w-3.5 h-3.5" />}
          onClick={() => handle("24h", onApprove24h)}
        />
        <ActionBtn
          color="bg-gray-500 hover:bg-gray-600 text-white"
          label="Send Manually"
          busy={acting === "manual"}
          icon={<Send className="w-3.5 h-3.5" />}
          onClick={() => handle("manual", onManual)}
        />
        <ActionBtn
          color="border border-red-200 text-red-600 hover:bg-red-50"
          label="Reject"
          busy={acting === "reject"}
          icon={<XCircle className="w-3.5 h-3.5" />}
          onClick={() => handle("reject", onReject)}
        />
      </div>

      <div className="px-4 pb-3 flex justify-end">
        <Link
          href={`/payments/requests/${req.id}`}
          className="text-xs text-[#009966] font-semibold hover:underline"
        >
          View full details →
        </Link>
      </div>
    </div>
  );
}

function ActionBtn({
  color, label, busy, icon, onClick,
}: {
  color: string; label: string; busy: boolean;
  icon: React.ReactNode; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={cn(
        "flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-60",
        color
      )}
    >
      {busy ? <InlineSpinner className="text-current" /> : icon}
      {label}
    </button>
  );
}

// ─── History row ──────────────────────────────────────────────────────────────

function HistoryRow({
  req, isLast,
}: {
  req: PaymentAccessRequestRow; isLast: boolean;
}) {
  const cfg = STATUS_CFG[req.status] ?? STATUS_CFG.pending;
  const created = new Date(req.created_at).toLocaleDateString("en-MY", {
    day: "numeric", month: "short",
  });

  return (
    <Link
      href={`/payments/requests/${req.id}`}
      className={cn(
        "flex items-center gap-3 py-3 -mx-4 px-4 hover:bg-gray-50 transition-colors",
        !isLast && "border-b border-gray-50"
      )}
    >
      <div className={cn("w-2 h-2 rounded-full shrink-0", cfg.dot)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-sm font-bold text-gray-900">{req.requester_name}</p>
          {req.otp_verified && (
            <span className="text-[9px] font-bold text-[#009966] bg-emerald-50 px-1.5 py-0.5 rounded-full border border-emerald-100">OTP</span>
          )}
        </div>
        <p className="text-[11px] text-gray-400 mt-0.5">
          {req.case_id.slice(-8)} · {created}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className={cn("text-[10px] font-bold", cfg.color)}>{cfg.label}</span>
        <ChevronRight className="w-4 h-4 text-gray-300" />
      </div>
    </Link>
  );
}

// ─── Stat chip ────────────────────────────────────────────────────────────────

function StatChip({ icon, label, value, bg }: {
  icon: React.ReactNode; label: string; value: number; bg: string;
}) {
  return (
    <div className={cn("rounded-xl p-3 flex flex-col items-center gap-1", bg)}>
      {icon}
      <p className="text-xl font-black text-gray-900">{value}</p>
      <p className="text-[10px] font-medium text-gray-500">{label}</p>
    </div>
  );
}
