"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SectionCard } from "@/components/ui/section-card";
import { PrimaryButton } from "@/components/ui/primary-button";
import { LoadingSpinner, InlineSpinner } from "@/components/ui/loading-spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { type CaseRow, type ReceivingAccountRow } from "@/lib/supabase/types";
import { useCase } from "@/hooks/use-case";
import { useReminders } from "@/hooks/use-reminders";
import { useBusinessId } from "@/hooks/use-business-id";
import { formatRM } from "@/lib/mock-data";
import { getPrimaryAccountClient } from "@/lib/db/receiving-accounts-client";
import { saveReminderClient } from "@/lib/db/reminders-client";
import { appendAuditLogClient } from "@/lib/db/audit-logs-client";
import { track } from "@/lib/analytics/tracker";
import {
  generateReminderMessage,
  buildWhatsAppLink,
  checkReminderFrequency,
  REMINDER_TYPES,
  REMINDER_STATUS_LABELS,
  REMINDER_STATUS_COLORS,
  type ReminderType,
} from "@/lib/reminders/generator";
import {
  ChevronLeft,
  Send,
  Copy,
  Check,
  AlertCircle,
  MessageCircle,
  RefreshCw,
  Clock,
  Save,
  Loader2,
  Phone,
  Info,
  Shield,
} from "lucide-react";

// ─── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  caseId: string;
}

// ─── Status options users can choose ─────────────────────────────────────────

const USER_STATUSES = [
  { value: "draft",            label: "Draft",           color: "border-gray-300 text-gray-600" },
  { value: "copied",           label: "Copied",          color: "border-blue-300 text-blue-700" },
  { value: "sent_manually",    label: "Sent Manually",   color: "border-emerald-300 text-emerald-700" },
  { value: "follow_up_needed", label: "Follow Up Needed",color: "border-amber-300 text-amber-700" },
] as const;

// ─── Main component ────────────────────────────────────────────────────────────

export function ReminderGeneratorPage({ caseId }: Props) {
  const { caseData, loading: caseLoading } = useCase(caseId);
  const { reminders, loading: remLoading, addReminder, updateStatus } = useReminders(caseId);
  const businessId = useBusinessId();

  const [account,         setAccount]         = useState<ReceivingAccountRow | null>(null);
  const [reminderType,    setReminderType]     = useState<ReminderType>("friendly");
  const [messageBody,     setMessageBody]      = useState("");
  const [userStatus,      setUserStatus]       = useState<typeof USER_STATUSES[number]["value"]>("draft");
  const [copied,          setCopied]           = useState(false);
  const [saving,          setSaving]           = useState(false);
  const [saveError,       setSaveError]        = useState<string | null>(null);
  const [savedId,         setSavedId]          = useState<string | null>(null);
  const [businessName,    setBusinessName]     = useState("our company");

  // Load primary receiving account
  useEffect(() => {
    getPrimaryAccountClient().then(setAccount);
  }, []);

  // Generate message whenever case/type/account changes
  useEffect(() => {
    if (!caseData) return;
    const msg = generateReminderMessage({
      reminderType,
      caseData,
      account,
      businessName,
    });
    setMessageBody(msg);
    setSavedId(null); // reset saved state on type change
    setCopied(false);
  }, [caseData, reminderType, account, businessName]);

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
  const freq = checkReminderFrequency(reminders);
  const waLink = buildWhatsAppLink(c.debtor_phone, messageBody);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(messageBody);
      setCopied(true);
      setUserStatus("copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the text
      const el = document.querySelector("textarea");
      el?.select();
    }
  }

  async function handleSave() {
    if (!messageBody.trim()) return;
    setSaving(true);
    setSaveError(null);

    const bId = businessId ?? "mock-business-id";

    const result = await saveReminderClient({
      case_id:       c.id,
      message_type:  reminderType,
      message_body:  messageBody,
      sent_channel:  "whatsapp",
      status:        userStatus,
      error_message: null,
    });

    if (result.error) {
      setSaveError(result.error);
    } else if (result.data) {
      addReminder(result.data);
      setSavedId(result.data.id);

      await appendAuditLogClient({
        business_id: bId,
        case_id:     c.id,
        action:      "reminder.created",
        actor_type:  "owner",
        metadata: {
          reminder_type: reminderType,
          status:        userStatus,
          channel:       "whatsapp",
        },
      });

      track("reminder_generated", {
        reminder_type: reminderType,
        channel:       "whatsapp",
      });
    }
    setSaving(false);
  }

  const currentTypeDef = REMINDER_TYPES.find((t) => t.id === reminderType)!;

  return (
    <div className="flex flex-col pb-24">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-2 mb-1">
          <Link href={`/cases/${c.id}`} className="text-gray-400 hover:text-gray-600">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-base font-bold text-[#0D1B3D]">Reminder Generator</h1>
        </div>
        <p className="text-xs text-gray-400 ml-7">Generate and copy a reminder message.</p>
      </div>

      <div className="px-4 pt-5 flex flex-col gap-5">
        {/* Case summary */}
        <div className="bg-[#0D1B3D] rounded-2xl p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] text-blue-300 font-semibold uppercase tracking-wide mb-1">
                Case
              </p>
              <p className="text-base font-black text-white leading-tight">{c.debtor_name}</p>
              {c.debtor_company && c.debtor_company !== c.debtor_name && (
                <p className="text-xs text-blue-200 mt-0.5">{c.debtor_company}</p>
              )}
              <p className="text-[11px] text-blue-300 mt-1 font-mono">{c.id}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[10px] text-blue-200 mb-0.5">Balance Due</p>
              <p className="text-xl font-black text-white">{formatRM(c.balance > 0 ? c.balance : c.amount_owed)}</p>
              <StatusBadge status={c.status} className="mt-1" />
            </div>
          </div>
          {c.debtor_phone && (
            <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-white/10">
              <Phone className="w-3 h-3 text-blue-300" />
              <p className="text-xs text-blue-200">{c.debtor_phone}</p>
            </div>
          )}
          {!c.debtor_phone && (
            <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-white/10">
              <AlertCircle className="w-3 h-3 text-amber-300" />
              <p className="text-xs text-amber-300">No phone number — add one to enable WhatsApp link</p>
            </div>
          )}
        </div>

        {/* Frequency warning */}
        {freq.tooFrequent && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
            <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 leading-relaxed">{freq.warningMessage}</p>
          </div>
        )}

        {/* Reminder type selector */}
        <div>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
            Reminder Type
          </p>
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
            {REMINDER_TYPES.map((t) => (
              <button
                key={t.id}
                onClick={() => setReminderType(t.id)}
                className={cn(
                  "shrink-0 flex flex-col items-center gap-1 px-3 py-2.5 rounded-xl border-2 text-center transition-all min-w-[80px]",
                  reminderType === t.id
                    ? "border-[#009966] bg-emerald-50"
                    : "border-gray-200 bg-white hover:border-gray-300"
                )}
              >
                <span className="text-lg">{t.emoji}</span>
                <span className={cn(
                  "text-[10px] font-bold leading-tight",
                  reminderType === t.id ? "text-[#009966]" : "text-gray-600"
                )}>
                  {t.label}
                </span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5">
            {currentTypeDef.description} · <span className="italic">{currentTypeDef.tone}</span>
          </p>
        </div>

        {/* Payment lock indicator */}
        <div className={cn(
          "flex items-center gap-2 rounded-xl px-3 py-2.5 border",
          c.payment_lock_mode === "immediate"
            ? "bg-emerald-50 border-emerald-200"
            : "bg-amber-50 border-amber-200"
        )}>
          <Shield className={cn(
            "w-3.5 h-3.5 shrink-0",
            c.payment_lock_mode === "immediate" ? "text-emerald-600" : "text-amber-600"
          )} />
          <p className={cn(
            "text-[11px] font-semibold",
            c.payment_lock_mode === "immediate" ? "text-emerald-700" : "text-amber-700"
          )}>
            {c.payment_lock_mode === "immediate"
              ? "Payment details included — payment access is immediate"
              : "Payment details locked — approval required message will be shown"}
          </p>
        </div>

        {/* Generated message */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">
              Generated Message
            </p>
            <button
              onClick={() => {
                const msg = generateReminderMessage({ reminderType, caseData: c, account, businessName });
                setMessageBody(msg);
                setSavedId(null);
              }}
              className="flex items-center gap-1 text-xs text-[#009966] font-semibold hover:text-emerald-700"
            >
              <RefreshCw className="w-3 h-3" />
              Reset
            </button>
          </div>
          <textarea
            value={messageBody}
            onChange={(e) => { setMessageBody(e.target.value); setSavedId(null); }}
            rows={12}
            className="w-full px-3 py-3 bg-white border border-gray-200 rounded-xl text-xs text-gray-700 font-mono leading-relaxed outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition-all resize-none"
          />
          <p className="text-[10px] text-gray-400 mt-1">{messageBody.length} characters</p>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm border-2 transition-all",
              copied
                ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                : "border-[#009966] bg-[#009966] text-white hover:bg-[#00B377]"
            )}
          >
            {copied ? (
              <><Check className="w-4 h-4" /> Copied!</>
            ) : (
              <><Copy className="w-4 h-4" /> Copy Message</>
            )}
          </button>

          {waLink ? (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setUserStatus("sent_manually")}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm border-2 border-[#25D366] bg-[#25D366] text-white hover:bg-[#1EBE5E] transition-all"
            >
              <MessageCircle className="w-4 h-4" />
              Open WhatsApp
            </a>
          ) : (
            <button
              disabled
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm border-2 border-gray-200 bg-gray-50 text-gray-300 cursor-not-allowed"
              title="Add phone number to enable"
            >
              <MessageCircle className="w-4 h-4" />
              WhatsApp
            </button>
          )}
        </div>

        {/* Status picker */}
        <div>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
            Reminder Status
          </p>
          <div className="grid grid-cols-2 gap-2">
            {USER_STATUSES.map((s) => (
              <button
                key={s.value}
                onClick={() => setUserStatus(s.value)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-semibold transition-all text-left",
                  userStatus === s.value
                    ? `${s.color} bg-opacity-10 border-current`
                    : "border-gray-200 text-gray-500 hover:border-gray-300"
                )}
              >
                <div className={cn(
                  "w-3 h-3 rounded-full border-2",
                  userStatus === s.value ? "border-current bg-current" : "border-gray-300"
                )} />
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Save */}
        {savedId ? (
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
            <Check className="w-4 h-4 text-emerald-600" />
            <p className="text-xs font-semibold text-emerald-700">
              Reminder saved successfully!
            </p>
          </div>
        ) : (
          <>
            {saveError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs text-red-700">{saveError}</p>
              </div>
            )}
            <PrimaryButton
              fullWidth
              size="lg"
              onClick={handleSave}
              disabled={saving || !messageBody.trim()}
              icon={saving ? <InlineSpinner className="text-white" /> : <Save className="w-4 h-4" />}
            >
              {saving ? "Saving…" : "Save Reminder"}
            </PrimaryButton>
          </>
        )}

        {/* Legal compliance notice */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex gap-2">
          <Info className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-gray-500 leading-relaxed">
            <strong>Legal Compliance:</strong> All reminders must be professional and respectful.
            Do not threaten, harass, or contact the debtor&apos;s family, employer, or friends.
            Comply with Malaysian consumer protection and debt collection laws.
          </p>
        </div>

        {/* Reminder history */}
        {!remLoading && reminders.length > 0 && (
          <ReminderHistory reminders={reminders} onUpdateStatus={updateStatus} />
        )}
      </div>
    </div>
  );
}

// ─── Reminder history ─────────────────────────────────────────────────────────

function ReminderHistory({
  reminders,
  onUpdateStatus,
}: {
  reminders: Array<import("@/lib/supabase/types").ReminderRow>;
  onUpdateStatus: (id: string, status: import("@/lib/supabase/types").ReminderStatus) => void;
}) {
  return (
    <SectionCard title={`Reminder History (${reminders.length})`}>
      <div className="flex flex-col mt-1">
        {reminders.map((r, i) => {
          const typeDef = REMINDER_TYPES.find((t) => t.id === r.message_type);
          const sentDate = new Date(r.sent_at).toLocaleDateString("en-MY", {
            day: "numeric", month: "short", year: "numeric",
          });
          return (
            <div
              key={r.id}
              className={cn(
                "flex items-start gap-3 py-3",
                i < reminders.length - 1 && "border-b border-gray-50"
              )}
            >
              <div className="w-8 h-8 bg-[#F2F4F7] rounded-lg flex items-center justify-center shrink-0 text-base">
                {typeDef?.emoji ?? "📩"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs font-bold text-gray-800">
                    {typeDef?.label ?? r.message_type}
                  </p>
                  <span className={cn(
                    "inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold border",
                    REMINDER_STATUS_COLORS[r.status] ?? "bg-gray-100 text-gray-600 border-gray-200"
                  )}>
                    {REMINDER_STATUS_LABELS[r.status] ?? r.status}
                  </span>
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5">{sentDate}</p>
                <p className="text-[11px] text-gray-500 mt-1 leading-snug line-clamp-2">
                  {r.message_body.split("\n").slice(0, 3).join(" ").slice(0, 120)}…
                </p>
                {/* Quick status update */}
                <div className="flex gap-1 mt-2 flex-wrap">
                  {(["copied", "sent_manually", "follow_up_needed"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => onUpdateStatus(r.id, s)}
                      className={cn(
                        "text-[9px] font-bold px-1.5 py-0.5 rounded border transition-all",
                        r.status === s
                          ? `${REMINDER_STATUS_COLORS[s]} font-black`
                          : "border-gray-200 text-gray-400 hover:border-gray-300"
                      )}
                    >
                      {REMINDER_STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
