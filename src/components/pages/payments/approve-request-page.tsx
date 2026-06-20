"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SectionCard } from "@/components/ui/section-card";
import { LoadingSpinner, InlineSpinner } from "@/components/ui/loading-spinner";
import { usePaymentAccess } from "@/hooks/use-payment-access";
import { useBusinessId } from "@/hooks/use-business-id";
import { appendAuditLogClient } from "@/lib/db/audit-logs-client";
import { track } from "@/lib/analytics/tracker";
import { type AccessType } from "@/lib/supabase/types";
import { timeUntilExpiry } from "@/lib/db/payment-access-client";
import {
  ChevronLeft, Phone, CheckCircle2, Clock, Send, X,
  ExternalLink, ShieldCheck, AlertTriangle, AlertCircle,
} from "lucide-react";

// ─── Approval options ─────────────────────────────────────────────────────────

const APPROVAL_OPTIONS: Array<{
  type:        AccessType;
  label:       string;
  description: string;
  icon:        React.ReactNode;
  recommended?: boolean;
  selectedBg:  string;
  color:       string;
}> = [
  {
    type:       "once",
    label:      "Approve Once",
    description:"Allows a single access session only.",
    icon:       <CheckCircle2 className="w-5 h-5" />,
    color:      "text-emerald-600",
    selectedBg: "border-[#009966] bg-emerald-50",
  },
  {
    type:       "24h",
    label:      "Approve for 24 Hours",
    description:"Access valid for the next 24 hours.",
    icon:       <Clock className="w-5 h-5" />,
    recommended:true,
    color:      "text-blue-600",
    selectedBg: "border-blue-500 bg-blue-50",
  },
  {
    type:       "manual",
    label:      "Send Manually",
    description:"Mark as sent — you share details yourself.",
    icon:       <Send className="w-5 h-5" />,
    color:      "text-gray-600",
    selectedBg: "border-gray-400 bg-gray-50",
  },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  requestId: string;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function ApproveRequestPage({ requestId }: Props) {
  const {
    request: req, loading, error,
    saving, saveError, approve, reject, markManual,
  } = usePaymentAccess(requestId);
  const businessId = useBusinessId();

  const [selected, setSelected] = React.useState<AccessType>("24h");

  if (loading) return <LoadingSpinner />;

  if (error || !req) {
    return (
      <div className="px-4 py-16 flex flex-col items-center gap-4">
        <AlertCircle className="w-8 h-8 text-red-400" />
        <p className="text-sm font-semibold text-gray-700">{error ?? "Request not found"}</p>
        <Link href="/payments/requests" className="text-sm text-[#009966] font-semibold">
          ← Back to Queue
        </Link>
      </div>
    );
  }

  // Already actioned
  if (req.status !== "pending") {
    return <ActionedView req={req} />;
  }

  const createdAt = new Date(req.created_at).toLocaleString("en-MY", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });

  async function handleApprove() {
    await approve(selected);
    await appendAuditLogClient({
      business_id: businessId ?? "mock-business-id",
      case_id:     req!.case_id,
      action:      "payment_access.approved",
      actor_type:  "owner",
      metadata:    { request_id: req!.id, access_type: selected, requester: req!.requester_name },
    });
    track("payment_access_approved", {
      case_id:     req!.case_id,
      access_type: selected,
    });
  }

  async function handleReject() {
    if (!req) return;
    await reject();
    await appendAuditLogClient({
      business_id: businessId ?? "mock-business-id",
      case_id:     req.case_id,
      action:      "payment_access.rejected",
      actor_type:  "owner",
      metadata:    { request_id: req.id, requester: req.requester_name },
    });
  }

  async function handleManual() {
    if (!req) return;
    await markManual();
    await appendAuditLogClient({
      business_id: businessId ?? "mock-business-id",
      case_id:     req.case_id,
      action:      "payment_access.sent_manually",
      actor_type:  "owner",
      metadata:    { request_id: req.id, requester: req.requester_name },
    });
  }

  return (
    <div className="flex flex-col pb-6">
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/payments/requests" className="text-gray-400 hover:text-gray-600">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-lg font-bold text-[#0D1B3D]">Payment Access Request</h1>
        </div>
      </div>

      <div className="px-4 pt-5 flex flex-col gap-5">
        {/* Requester card */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-2xl bg-[#0D1B3D] flex items-center justify-center text-white font-bold text-sm shrink-0">
              {req.requester_name.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-bold text-gray-900">{req.requester_name}</p>
                {req.otp_verified && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-[#009966] bg-emerald-50 px-1.5 py-0.5 rounded-full border border-emerald-100">
                    <ShieldCheck className="w-3 h-3" /> OTP Verified
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 text-[11px] text-gray-400 mt-0.5">
                <Phone className="w-3 h-3" />
                {req.requester_phone}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-[#F2F4F7] rounded-xl p-3">
              <p className="text-[10px] text-gray-400 mb-1">Case ID</p>
              <p className="text-xs font-bold text-gray-800 font-mono">{req.case_id.slice(-12)}</p>
            </div>
            <div className="bg-[#0D1B3D] rounded-xl p-3">
              <p className="text-[10px] text-blue-200 mb-1">Requested</p>
              <p className="text-xs font-bold text-white">{createdAt}</p>
            </div>
          </div>

          {(req.preferred_method || req.reason) && (
            <div className="mt-3 pt-3 border-t border-gray-50 flex flex-col gap-1">
              {req.preferred_method && (
                <p className="text-[11px] text-gray-500">
                  <span className="font-semibold text-gray-700">Method: </span>
                  {req.preferred_method}
                </p>
              )}
              {req.reason && (
                <p className="text-[11px] text-gray-500 italic">
                  &ldquo;{req.reason}&rdquo;
                </p>
              )}
            </div>
          )}
        </div>

        {/* Approval options */}
        <SectionCard title="Approval Options">
          <div className="flex flex-col gap-2 mt-2">
            {APPROVAL_OPTIONS.map((opt) => {
              const isSelected = selected === opt.type;
              return (
                <button
                  key={opt.type}
                  onClick={() => setSelected(opt.type)}
                  className={cn(
                    "flex items-center gap-3 p-3.5 rounded-xl border-2 text-left transition-all",
                    isSelected ? opt.selectedBg : "border-gray-100 bg-white hover:border-gray-200"
                  )}
                >
                  <div className={cn("w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0",
                    isSelected ? "border-[#009966] bg-[#009966]" : "border-gray-300"
                  )}>
                    {isSelected && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                  </div>
                  <div className={cn("shrink-0", isSelected ? opt.color : "text-gray-400")}>
                    {opt.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-gray-900">{opt.label}</p>
                      {opt.recommended && (
                        <span className="text-[9px] font-bold text-[#009966] bg-emerald-100 px-1.5 py-0.5 rounded-full">
                          Recommended
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5">{opt.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">
            All approved payments still require proof review.
          </p>
        </SectionCard>

        {/* Error */}
        {saveError && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
            <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
            <p className="text-xs text-red-700">{saveError}</p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-col gap-2">
          <PrimaryButton fullWidth size="lg" onClick={handleApprove} disabled={saving}>
            {saving
              ? <InlineSpinner className="text-white" />
              : <CheckCircle2 className="w-4 h-4" />}
            {saving ? "Processing…" : "Approve Access"}
          </PrimaryButton>

          <button
            onClick={handleManual}
            disabled={saving}
            className="flex items-center justify-center gap-2 w-full py-3 border-2 border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:border-[#009966] hover:text-[#009966] transition-colors disabled:opacity-60"
          >
            <Send className="w-4 h-4" />
            Send Manually
          </button>

          <button
            onClick={handleReject}
            disabled={saving}
            className="flex items-center justify-center gap-2 w-full py-3 border-2 border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:border-red-200 hover:text-red-600 transition-colors disabled:opacity-60"
          >
            <X className="w-4 h-4" />
            Reject Request
          </button>

          <Link
            href={`/cases/${req.case_id}`}
            className="flex items-center justify-center gap-2 text-sm font-semibold text-[#009966] py-2"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View Case Details
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Already actioned view ────────────────────────────────────────────────────

function ActionedView({ req }: { req: import("@/lib/supabase/types").PaymentAccessRequestRow }) {
  const isApproved = req.status === "approved";
  const isRejected = req.status === "rejected";
  const isSentManually = req.status === "sent_manually";

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 py-16 text-center">
      <div className={cn(
        "w-16 h-16 rounded-full flex items-center justify-center mb-4",
        isApproved || isSentManually ? "bg-emerald-100" : "bg-red-50"
      )}>
        {(isApproved || isSentManually)
          ? <CheckCircle2 className="w-8 h-8 text-[#009966]" />
          : <AlertTriangle className="w-8 h-8 text-red-400" />
        }
      </div>

      <h2 className="text-lg font-black text-[#0D1B3D]">
        {isApproved && "Access Approved"}
        {isRejected && "Request Rejected"}
        {isSentManually && "Sent Manually"}
        {req.status === "expired" && "Access Expired"}
      </h2>

      <p className="text-sm text-gray-500 mt-2 leading-relaxed max-w-xs">
        {isApproved && req.expires_at && `Expires: ${timeUntilExpiry(req.expires_at)}`}
        {isApproved && !req.expires_at && "Single-use access granted."}
        {isRejected && `${req.requester_name}'s request has been rejected.`}
        {isSentManually && "Payment details were sent manually."}
        {req.status === "expired" && "This access has expired."}
      </p>

      <div className="mt-6 w-full flex flex-col gap-2">
        <Link href="/payments/requests">
          <PrimaryButton fullWidth>Back to Queue</PrimaryButton>
        </Link>
        <Link href={`/cases/${req.case_id}`}>
          <PrimaryButton fullWidth variant="ghost">View Case</PrimaryButton>
        </Link>
      </div>
    </div>
  );
}

// Hoisting import for React
import React from "react";
