"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SectionCard } from "@/components/ui/section-card";
import { PrimaryButton } from "@/components/ui/primary-button";
import { LoadingSpinner, InlineSpinner } from "@/components/ui/loading-spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { type ContactGuardEvaluation, type ReceivingAccountRow } from "@/lib/supabase/types";
import { useCase } from "@/hooks/use-case";
import { useReminders } from "@/hooks/use-reminders";
import { useCommunicationActivities } from "@/hooks/use-communication-activities";
import { useBusinessProfile } from "@/hooks/use-business-profile";
import { useAuth } from "@/hooks/use-auth";
import { formatRM } from "@/lib/mock-data";
import { getPrimaryAccountClient } from "@/lib/db/receiving-accounts-client";
import { confirmReminderSentClient, generateReminderClient, recordReminderHandoffClient } from "@/lib/db/reminders-client";
import {
  generateReminderMessage,
  buildEmailLink,
  buildWhatsAppLink,
  REMINDER_TYPES,
  REMINDER_STATUS_LABELS,
  REMINDER_STATUS_COLORS,
  type ReminderType,
} from "@/lib/reminders/generator";
import {
  ChevronLeft,
  Copy,
  Check,
  AlertCircle,
  MessageCircle,
  RefreshCw,
  Save,
  Phone,
  Info,
  Shield,
  Mail,
} from "lucide-react";

// ─── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  caseId: string;
}

function promptForContactOverride(guardrail: ContactGuardEvaluation | undefined): string | undefined | null {
  if (!guardrail?.warnings.length) return undefined;
  const reason = window.prompt(
    `${guardrail.warnings.join("\n")}\n\n${guardrail.recommended_action}\n\n` +
    "To continue, enter a short operational reason. Cancel to follow the recommendation.",
  );
  if (reason === null) return null;
  if (reason.trim().length < 3) return null;
  return reason.trim();
}

// ─── Status options users can choose ─────────────────────────────────────────

// ─── Main component ────────────────────────────────────────────────────────────

export function ReminderGeneratorPage({ caseId }: Props) {
  const { caseData, loading: caseLoading } = useCase(caseId);
  const { reminders, loading: remLoading, refresh: refreshReminders } = useReminders(caseId);
  const communications = useCommunicationActivities(caseId);

  const [account,         setAccount]         = useState<ReceivingAccountRow | null>(null);
  const [reminderType,    setReminderType]     = useState<ReminderType>("friendly");
  const [messageBody,     setMessageBody]      = useState("");
  const [channel,         setChannel]          = useState<"whatsapp" | "email">("whatsapp");
  const [copied,          setCopied]           = useState(false);
  const [saving,          setSaving]           = useState(false);
  const [saveError,       setSaveError]        = useState<string | null>(null);
  const [savedId,         setSavedId]          = useState<string | null>(null);
  const { profile, loading: profileLoading } = useBusinessProfile();
  const { user } = useAuth();
  // Same precedence as the server-side generator: legal name, then trading name.
  const businessName = profile?.legalName?.trim() || profile?.displayName?.trim() || user?.name?.trim() || "Accounts Team";
  const generationRequestKey = useRef<string | null>(null);

  // Load primary receiving account
  useEffect(() => {
    if (!caseData) return;
    getPrimaryAccountClient(caseData.currency).then(setAccount);
  }, [caseData]);

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
      setSavedId(null); // a changed draft must be regenerated from current server data
      generationRequestKey.current = null;
    setCopied(false);
  }, [caseData, reminderType, account, businessName]);

  if (caseLoading || profileLoading) return <LoadingSpinner />;

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
  const contactGuard = communications.guardrails[channel];
  const waLink = buildWhatsAppLink(c.debtor_phone, messageBody);
  const emailLink = buildEmailLink(c.debtor_email, `Payment reminder${c.invoice_no ? ` — ${c.invoice_no}` : ""}`, messageBody);

  async function handleCopy() {
    if (!savedId) {
      setSaveError("Generate the current reminder before opening a delivery handoff.");
      return;
    }
    try {
      await navigator.clipboard.writeText(messageBody);
      const result = await recordReminderHandoffClient(c.id, savedId, "copy");
      if (result.error) setSaveError(result.error);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the text
      const el = document.querySelector("textarea");
      el?.select();
    }
  }

  async function handleGenerate() {
    if (!messageBody.trim()) return;
    setSaving(true);
    setSaveError(null);

    const requestKey = generationRequestKey.current ?? crypto.randomUUID();
    generationRequestKey.current = requestKey;
    const result = await generateReminderClient({ caseId: c.id, messageType: reminderType, channel, requestKey, messageBody });

    if (result.error) {
      setSaveError(result.error);
      generationRequestKey.current = null;
    } else if (result.data) {
      await refreshReminders();
      setSavedId(result.data.id);
      setMessageBody(result.data.message_body);
    }
    setSaving(false);
  }

  async function handleComposer(handoff: "whatsapp" | "email", href: string) {
    if (!savedId || !href) return;
    const overrideReason = promptForContactOverride(communications.guardrails[handoff]);
    if (overrideReason === null) return;
    setSaving(true);
    setSaveError(null);
    const result = await recordReminderHandoffClient(c.id, savedId, handoff, overrideReason);
    if (result.error) setSaveError(result.error);
    else {
      await refreshReminders();
      await communications.refresh();
      window.open(href, "_blank", "noopener,noreferrer");
    }
    setSaving(false);
  }

  async function handleConfirmSent() {
    if (!savedId) return;
    const savedReminder = reminders.find((reminder) => reminder.id === savedId);
    const overrideReason = savedReminder?.composer_opened_at
      ? undefined
      : promptForContactOverride(contactGuard);
    if (overrideReason === null) return;
    setSaving(true);
    setSaveError(null);
    const result = await confirmReminderSentClient(c.id, savedId, undefined, overrideReason);
    if (result.error) setSaveError(result.error);
    else await refreshReminders();
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
        {contactGuard?.warnings.length > 0 && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
            <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              {contactGuard.warnings.map((warning) => <p key={warning} className="text-xs text-amber-700 leading-relaxed">{warning}</p>)}
              <p className="mt-1 text-xs font-bold text-amber-800">{contactGuard.recommended_action}</p>
            </div>
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
                generationRequestKey.current = null;
              }}
              className="flex items-center gap-1 text-xs text-[#009966] font-semibold hover:text-emerald-700"
            >
              <RefreshCw className="w-3 h-3" />
              Reset
            </button>
          </div>
          <textarea
            value={messageBody}
            readOnly
            rows={12}
            className="w-full px-3 py-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-700 font-mono leading-relaxed resize-none"
          />
          <p className="text-[10px] text-gray-400 mt-1">{messageBody.length} characters · regenerated from current case data when recorded</p>
        </div>

        {/* Delivery handoffs are recorded as composer opens, never as delivery. */}
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

          {waLink && savedId ? (
            <button
              onClick={() => void handleComposer("whatsapp", waLink)}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm border-2 border-[#25D366] bg-[#25D366] text-white hover:bg-[#1EBE5E] transition-all"
            >
              <MessageCircle className="w-4 h-4" />
              Open WhatsApp
            </button>
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

        {emailLink && savedId && (
          <button
            onClick={() => void handleComposer("email", emailLink)}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm border-2 border-blue-500 bg-blue-500 text-white hover:bg-blue-600 transition-all"
          >
            <Mail className="w-4 h-4" /> Open Email Composer
          </button>
        )}

        <div className="grid grid-cols-2 gap-2">
          {(["whatsapp", "email"] as const).map((option) => (
            <button
              key={option}
              onClick={() => { setChannel(option); setSavedId(null); generationRequestKey.current = null; }}
              className={cn("rounded-xl border-2 px-3 py-2 text-sm font-semibold", channel === option ? "border-[#009966] bg-emerald-50 text-emerald-700" : "border-gray-200 text-gray-500")}
            >
              Generate for {option === "whatsapp" ? "WhatsApp" : "Email"}
            </button>
          ))}
        </div>

        {/* Generation is separate from manual delivery confirmation. */}
        {savedId ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
              <Check className="w-4 h-4 text-emerald-600" />
              <p className="text-xs font-semibold text-emerald-700">Generated and recorded. A composer open is not delivery.</p>
            </div>
            <PrimaryButton fullWidth size="lg" onClick={() => void handleConfirmSent()} disabled={saving} icon={<Check className="w-4 h-4" />}>
              Confirm sent manually
            </PrimaryButton>
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
              onClick={handleGenerate}
              disabled={saving || !messageBody.trim()}
              icon={saving ? <InlineSpinner className="text-white" /> : <Save className="w-4 h-4" />}
            >
              {saving ? "Generating…" : "Generate and record reminder"}
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
          <ReminderHistory reminders={reminders} />
        )}
      </div>
    </div>
  );
}

// ─── Reminder history ─────────────────────────────────────────────────────────

function ReminderHistory({
  reminders,
}: {
  reminders: Array<import("@/lib/supabase/types").ReminderRow>;
}) {
  return (
    <SectionCard title={`Reminder History (${reminders.length})`}>
      <div className="flex flex-col mt-1">
        {reminders.map((r, i) => {
          const typeDef = REMINDER_TYPES.find((t) => t.id === r.message_type);
          const generatedDate = new Date(r.generated_at).toLocaleDateString("en-MY", {
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
                <p className="text-[10px] text-gray-400 mt-0.5">Generated {generatedDate} · template v{r.template_version}</p>
                <p className="text-[11px] text-gray-500 mt-1 leading-snug line-clamp-2">
                  {r.message_body.split("\n").slice(0, 3).join(" ").slice(0, 120)}…
                </p>
                <p className="text-[10px] text-gray-400 mt-2">{r.manually_confirmed_at ? `Manual send confirmed${r.next_action_at ? ` · next action ${new Date(r.next_action_at).toLocaleDateString("en-MY")}` : ""}` : r.composer_opened_at ? "Composer opened — delivery not confirmed" : "Generated — delivery not confirmed"}</p>
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
