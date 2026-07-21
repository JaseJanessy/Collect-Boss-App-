"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SectionCard } from "@/components/ui/section-card";
import { LoadingSpinner, InlineSpinner } from "@/components/ui/loading-spinner";
import { useCase } from "@/hooks/use-case";
import { useBusinessId } from "@/hooks/use-business-id";
import { type PaymentLockMode } from "@/lib/supabase/types";
import { updateCaseLockModeClient } from "@/lib/db/cases-client";
import { appendAuditLogClient } from "@/lib/db/audit-logs-client";
import { formatRM } from "@/lib/mock-data";
import {
  ChevronLeft, Eye, ShieldCheck, Lock, CheckCircle2,
  Smartphone, FileCheck, Clock, User, ExternalLink,
  AlertCircle, Save,
} from "lucide-react";

// ─── Lock mode options ────────────────────────────────────────────────────────

const lockOptions: Array<{
  mode:        PaymentLockMode;
  icon:        React.ReactNode;
  iconBg:      string;
  label:       string;
  description: string;
  recommended?: boolean;
}> = [
  {
    mode:        "immediate",
    icon:        <Eye className="w-4 h-4 text-blue-600" />,
    iconBg:      "bg-blue-50",
    label:       "Show Payment Details Immediately",
    description: "Debtors can view payment details right away, no approval needed.",
  },
  {
    mode:        "approval",
    icon:        <ShieldCheck className="w-4 h-4 text-[#009966]" />,
    iconBg:      "bg-emerald-50",
    label:       "Require Approval Before Showing",
    description: "You receive a request and approve before payment details are shared.",
    recommended: true,
  },
  {
    mode:        "manual",
    icon:        <Lock className="w-4 h-4 text-orange-600" />,
    iconBg:      "bg-orange-50",
    label:       "Locked — Send Manually Only",
    description: "Payment details are fully locked. You share them manually.",
  },
];

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        "relative w-11 h-6 rounded-full transition-colors shrink-0",
        checked ? "bg-[#009966]" : "bg-gray-200"
      )}
    >
      <span className={cn(
        "absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all",
        checked ? "left-[22px]" : "left-0.5"
      )} />
    </button>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  caseId: string;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function PaymentAccessSettingsPage({ caseId }: Props) {
  const { caseData, loading: caseLoading, update } = useCase(caseId);
  const businessId = useBusinessId();

  const [lockMode,   setLockMode]  = useState<PaymentLockMode | null>(null);
  const [saving,     setSaving]    = useState(false);
  const [saved,      setSaved]     = useState(false);
  const [saveError,  setSaveError] = useState<string | null>(null);
  const [publicUrl,  setPublicUrl] = useState<string | null>(null);
  const [creatingPublicLink, setCreatingPublicLink] = useState(false);

  // Local-only security controls (not yet persisted to DB)
  const [requireOtp,    setRequireOtp]    = useState(true);
  const [manualProof,   setManualProof]   = useState(true);
  const [autoHide,      setAutoHide]      = useState(true);
  const [oneTimeAccess, setOneTimeAccess] = useState(false);

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

  const c = caseData;
  const currentMode = lockMode ?? c.payment_lock_mode;

  async function handleSave() {
    if (!lockMode) return;
    setSaving(true);
    setSaveError(null);

    const result = await updateCaseLockModeClient(c.id, lockMode);
    if (result.error) {
      setSaveError(result.error);
    } else {
      update(result.data!);
      setLockMode(null); // reset to derived from caseData
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      await appendAuditLogClient({
        business_id: businessId ?? "mock-business-id",
        case_id:     c.id,
        action:      "case.lock_mode_updated",
        actor_type:  "owner",
        metadata:    { from: c.payment_lock_mode, to: lockMode },
      });
    }
    setSaving(false);
  }

  const isDirty = lockMode !== null && lockMode !== c.payment_lock_mode;

  async function createPaymentLink() {
    setCreatingPublicLink(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(c.id)}/public-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "payment", expiresInHours: autoHide ? 24 : 168 }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || typeof payload.url !== "string") {
        setSaveError(typeof payload.error === "string" ? payload.error : "Unable to create secure payment link.");
      } else {
        setPublicUrl(payload.url);
        await navigator.clipboard.writeText(payload.url).catch(() => {});
      }
    } catch {
      setSaveError("Unable to create secure payment link.");
    } finally {
      setCreatingPublicLink(false);
    }
  }

  return (
    <div className="flex flex-col pb-6">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-2 mb-1">
          <Link href={`/cases/${c.id}`} className="text-gray-400 hover:text-gray-600">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-lg font-bold text-[#0D1B3D]">Payment Access</h1>
        </div>
        <p className="text-xs text-gray-400 ml-7">
          Control how and when debtors can view payment details.
        </p>
      </div>

      <div className="px-4 pt-5 flex flex-col gap-5">
        {/* Case summary */}
        <div className="bg-[#F2F4F7] rounded-2xl p-4">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Case</p>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#0D1B3D] flex items-center justify-center text-white text-sm font-bold shrink-0">
              {c.debtor_name.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900 truncate">{c.debtor_name}</p>
              <p className="text-[11px] text-gray-400 font-mono">{c.id}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[10px] text-gray-400">Balance Due</p>
              <p className="text-sm font-black text-[#0D1B3D]">{formatRM(c.balance)}</p>
            </div>
          </div>
        </div>

        {/* Payment lock mode */}
        <SectionCard title="Payment Visibility Rule">
          <p className="text-[11px] text-gray-400 mb-3 mt-1">
            Choose how debtors can access your payment details for this case.
          </p>
          <div className="flex flex-col gap-2">
            {lockOptions.map((opt) => {
              const isSelected = currentMode === opt.mode;
              return (
                <button
                  key={opt.mode}
                  onClick={() => setLockMode(opt.mode)}
                  className={cn(
                    "flex items-start gap-3 p-3.5 rounded-xl border-2 text-left transition-all",
                    isSelected
                      ? "border-[#009966] bg-emerald-50"
                      : "border-gray-100 bg-white hover:border-gray-200"
                  )}
                >
                  <div className={cn(
                    "w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5",
                    isSelected ? "border-[#009966] bg-[#009966]" : "border-gray-300"
                  )}>
                    {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                  <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", opt.iconBg)}>
                    {opt.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-gray-900">{opt.label}</p>
                      {opt.recommended && (
                        <span className="text-[9px] font-bold text-[#009966] bg-emerald-100 px-1.5 py-0.5 rounded-full">
                          Recommended
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">{opt.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </SectionCard>

        {/* Warning for locked modes */}
        {(currentMode === "approval" || currentMode === "manual") && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
            <Lock className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-amber-800">Payment details are locked</p>
              <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
                {currentMode === "approval"
                  ? "Debtors will see: \"Payment details will be provided after approval.\" They must request access first."
                  : "Payment details will not be shown to debtors. You must send them manually."}
              </p>
            </div>
          </div>
        )}

        {/* Security controls (UI-only, not yet persisted) */}
        <SectionCard title="Security Controls">
          <p className="text-[11px] text-gray-400 mb-3 mt-1">
            Additional safeguards for payment information.
          </p>
          <div className="flex flex-col gap-1">
            {[
              { icon: <Smartphone className="w-4 h-4 text-blue-500" />, label: "Require OTP before request", sub: "Debtor must verify phone number", checked: requireOtp, onChange: setRequireOtp },
              { icon: <FileCheck className="w-4 h-4 text-purple-500" />, label: "Manual proof required", sub: "You review payment proof before marking paid", checked: manualProof, onChange: setManualProof },
              { icon: <Clock className="w-4 h-4 text-amber-500" />, label: "Auto-hide after 24 hours", sub: "Payment details expire automatically", checked: autoHide, onChange: setAutoHide },
              { icon: <User className="w-4 h-4 text-gray-400" />, label: "One-time access only", sub: "Details shown once, then locked again", checked: oneTimeAccess, onChange: setOneTimeAccess },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
                <div className="flex items-start gap-2.5 flex-1 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center shrink-0 mt-0.5">{row.icon}</div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{row.label}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{row.sub}</p>
                  </div>
                </div>
                <div className="ml-3"><Toggle checked={row.checked} onChange={row.onChange} /></div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">
            ⚠️ Security controls are locally set and will be persisted in a future update.
          </p>
        </SectionCard>

        {/* Payment reference */}
        <SectionCard title="Payment Reference">
          <p className="text-[11px] text-gray-400 mb-3 mt-1">
            Debtors must include this reference when making payment.
          </p>
          <div className="bg-[#F2F4F7] rounded-xl px-4 py-3">
            <p className="text-[10px] text-gray-400 mb-1">Reference Code</p>
            <p className="text-xl font-black text-[#0D1B3D] font-mono tracking-wide">{c.id}</p>
          </div>
        </SectionCard>

        <button
          type="button"
          onClick={createPaymentLink}
          disabled={creatingPublicLink}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 py-3 text-sm font-semibold text-gray-600 transition-colors hover:border-gray-300 disabled:opacity-60"
        >
          {creatingPublicLink ? <InlineSpinner /> : <ExternalLink className="w-4 h-4" />}
          Create secure payment link
        </button>
        {publicUrl && <a href={publicUrl} target="_blank" rel="noreferrer" className="break-all text-center text-xs font-semibold text-[#009966] hover:underline">{publicUrl}</a>}

        {/* Error */}
        {saveError && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-2.5">
            <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
            <p className="text-xs text-red-700">{saveError}</p>
          </div>
        )}

        <PrimaryButton
          fullWidth
          size="lg"
          onClick={handleSave}
          disabled={saving || !isDirty}
          icon={saving ? <InlineSpinner className="text-white" /> : undefined}
        >
          {saved ? (
            <span className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> Saved!
            </span>
          ) : saving ? "Saving…" : "Save Payment Rule"}
        </PrimaryButton>

        {!isDirty && !saved && (
          <p className="text-[11px] text-center text-gray-400">
            Change the visibility rule above to enable save.
          </p>
        )}
      </div>
    </div>
  );
}
