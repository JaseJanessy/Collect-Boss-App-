"use client";
import { friendlyErrorMessage } from "@/lib/ui/friendly-error";

import { useEffect, useState } from "react";
import { Mail, MessageCircle, Phone } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import {
  CALL_OUTCOME_LABELS,
  CALL_OUTCOMES,
  COMMUNICATION_CHANNEL_LABELS,
  COMMUNICATION_STATUS_LABELS,
  type CallOutcome,
} from "@/lib/communications/model";
import {
  callHandoffAdapter,
  whatsappHandoffAdapter,
} from "@/lib/communications/adapters";
import { parseEmailList } from "@/lib/email/model";
import type {
  CommunicationActivityRow,
  CommunicationChannel,
  CommunicationCounters,
  ContactFrequencyPolicy,
  ContactGuardEvaluation,
  ContactPreferenceRow,
} from "@/lib/supabase/types";
import { useRegion } from "@/contexts/region-context";
import { formatDateTime } from "@/lib/international/formatting";
import type { RegionSettings } from "@/lib/international/types";

function formatTimestamp(value: string | null, settings: RegionSettings) {
  if (!value) return "—";
  return formatDateTime(value, settings);
}

function CounterGrid({ label, counters, settings }: { label: string; counters: CommunicationCounters; settings: RegionSettings }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Calls", value: counters.calls },
          { label: "WhatsApps", value: counters.whatsapps },
          { label: "Emails", value: counters.emails },
        ].map((item) => (
          <div key={item.label} className="rounded-xl bg-[#F2F4F7] px-2 py-2 text-center">
            <p className="text-lg font-black text-[#0D1B3D]">{item.value}</p>
            <p className="text-[10px] font-semibold text-gray-500">{item.label}</p>
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-gray-500">
        <p>Last Contact<br /><span className="font-semibold text-gray-700">{formatTimestamp(counters.last_contact_at, settings)}</span></p>
        <p>Last Response<br /><span className="font-semibold text-gray-700">{formatTimestamp(counters.last_response_at, settings)}</span></p>
      </div>
    </div>
  );
}

export function CommunicationActivityPanel({
  debtorName,
  caseId,
  phone,
  email,
  activities,
  caseCounters,
  customerCounters,
  preferences,
  policy,
  guardrails,
  loading,
  error,
  initiate,
  recordCallOutcome,
  savePreferences,
  savePolicy,
  refresh,
}: {
  debtorName: string;
  caseId: string;
  phone: string | null;
  email: string | null;
  activities: CommunicationActivityRow[];
  caseCounters: CommunicationCounters;
  customerCounters: CommunicationCounters;
  preferences: ContactPreferenceRow | null;
  policy: ContactFrequencyPolicy;
  guardrails: Record<"call" | "whatsapp" | "email", ContactGuardEvaluation>;
  loading: boolean;
  error: string | null;
  initiate: (channel: "call" | "whatsapp", overrideReason?: string) => Promise<{ data?: CommunicationActivityRow; error?: string }>;
  recordCallOutcome: (activityId: string, outcome: CallOutcome) => Promise<{ data?: CommunicationActivityRow; error?: string }>;
  savePreferences: (input: {
    preferred_channel: CommunicationChannel | null;
    preferred_time_start: string;
    preferred_time_end: string;
    email_only: boolean;
    do_not_call: boolean;
    wrong_number: boolean;
    invalid_contact: boolean;
    do_not_email: boolean;
    email_invalid: boolean;
    email_unsubscribed: boolean;
    note: string;
  }) => Promise<{ data?: ContactPreferenceRow; error?: string }>;
  savePolicy: (input: ContactFrequencyPolicy) => Promise<{ data?: ContactFrequencyPolicy; error?: string }>;
  refresh: () => Promise<void>;
}) {
  const { configuration } = useRegion();
  const [working, setWorking] = useState<"call" | "whatsapp" | "outcome" | null>(null);
  const [pendingCallId, setPendingCallId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);

  async function launch(channel: "call" | "whatsapp") {
    if (!phone || working) return;
    setWorking(channel);
    setActionError(null);
    const guardrail = guardrails[channel];
    let overrideReason: string | undefined;
    if (guardrail?.warnings.length) {
      const reason = window.prompt(
        `${guardrail.warnings.join("\n")}\n\n${guardrail.recommended_action}\n\n` +
        "To continue, enter a short operational reason. Cancel to follow the recommendation.",
      );
      if (reason === null) {
        setWorking(null);
        return;
      }
      if (reason.trim().length < 3) {
        setActionError("Enter at least 3 characters when overriding a contact warning.");
        setWorking(null);
        return;
      }
      overrideReason = reason.trim();
    }
    const result = await initiate(channel, overrideReason);
    if (!result.data) {
      setActionError(result.error ?? "Unable to log communication attempt.");
      setWorking(null);
      return;
    }
    if (channel === "call") {
      setPendingCallId(result.data.id);
      window.location.href = callHandoffAdapter.buildLaunchUrl(phone);
    } else {
      const message = `Hello ${debtorName}, I am following up regarding your account.`;
      window.open(whatsappHandoffAdapter.buildLaunchUrl(phone, message), "_blank", "noopener,noreferrer");
    }
    setWorking(null);
  }

  async function saveOutcome(outcome: CallOutcome) {
    if (!pendingCallId) return;
    setWorking("outcome");
    setActionError(null);
    const result = await recordCallOutcome(pendingCallId, outcome);
    if (result.data) setPendingCallId(null);
    else setActionError(result.error ?? "Unable to save call outcome.");
    setWorking(null);
  }

  return (
    <SectionCard title="Communication">
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={!phone || working !== null} onClick={() => void launch("call")}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#0D1B3D] px-3 py-2.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
          <Phone className="h-4 w-4" /> {working === "call" ? "Logging…" : "Call"}
        </button>
        <button type="button" disabled={!phone || working !== null} onClick={() => void launch("whatsapp")}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#009966] px-3 py-2.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
          <MessageCircle className="h-4 w-4" /> {working === "whatsapp" ? "Logging…" : "WhatsApp"}
        </button>
        <button type="button" disabled={!email || working !== null} onClick={() => setEmailOpen((value) => !value)}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#009966] bg-white px-3 py-2.5 text-xs font-bold text-[#009966] disabled:cursor-not-allowed disabled:opacity-50">
          <Mail className="h-4 w-4" /> Email
        </button>
      </div>
      {!phone && <p className="mt-2 text-[11px] font-semibold text-amber-700">Add a customer phone number to use Call or WhatsApp.</p>}
      {!email && <p className="mt-2 text-[11px] font-semibold text-amber-700">Add a customer email address to send email.</p>}
      <p className="mt-2 text-[10px] text-gray-400">WhatsApp opens a device handoff. CollectBoss cannot read personal WhatsApp replies automatically.</p>
      {emailOpen && email && (
        <EmailComposer caseId={caseId} defaultEmail={email} guardrail={guardrails.email}
          onClose={() => setEmailOpen(false)} onComplete={refresh} />
      )}
      {Object.values(guardrails).some((guardrail) => guardrail.warnings.length > 0) && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-bold text-amber-800">Contact recommendation</p>
          {[...new Set(Object.values(guardrails).flatMap((guardrail) => guardrail.warnings))].map((warning) => (
            <p key={warning} className="mt-1 text-[11px] text-amber-700">{warning}</p>
          ))}
          <p className="mt-1.5 text-[11px] font-semibold text-amber-800">
            {guardrails.call?.recommended_action ?? guardrails.whatsapp?.recommended_action}
          </p>
        </div>
      )}

      {pendingCallId && (
        <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3">
          <p className="text-xs font-bold text-[#0D1B3D]">How did the call go?</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {CALL_OUTCOMES.map((outcome) => (
              <button key={outcome} type="button" disabled={working === "outcome"} onClick={() => void saveOutcome(outcome)}
                className="rounded-lg border border-blue-100 bg-white px-2.5 py-1.5 text-[10px] font-bold text-gray-700 hover:border-[#009966] hover:text-[#009966] disabled:opacity-50">
                {CALL_OUTCOME_LABELS[outcome]}
              </button>
            ))}
          </div>
        </div>
      )}

      {(actionError || error) && <p className="mt-2 text-[11px] font-semibold text-red-600">{actionError ?? error}</p>}
      <div className="mt-4 space-y-4">
        <CounterGrid label="This case" counters={caseCounters} settings={configuration.settings} />
        <CounterGrid label="Customer totals" counters={customerCounters} settings={configuration.settings} />
      </div>
      <ContactControls
        key={`${preferences?.updated_at ?? "new"}:${JSON.stringify(policy)}`}
        preferences={preferences}
        policy={policy}
        disabled={working !== null}
        savePreferences={savePreferences}
        savePolicy={savePolicy}
      />
      {loading && <p className="mt-3 text-xs text-gray-400">Loading communication activity…</p>}
      {!loading && activities.length > 0 && (
        <p className="mt-3 text-[10px] text-gray-400">{activities.length} communication {activities.length === 1 ? "entry" : "entries"} in this case timeline.</p>
      )}
    </SectionCard>
  );
}

interface ComposerTemplate {
  id: string;
  name: string;
  rendered_subject: string;
  rendered_body: string;
}

interface ComposerAttachment {
  id: string;
  file_name: string;
  file_size_bytes: number | null;
  file_type: string;
}

function EmailComposer({
  caseId,
  defaultEmail,
  guardrail,
  onClose,
  onComplete,
}: {
  caseId: string;
  defaultEmail: string;
  guardrail: ContactGuardEvaluation;
  onClose: () => void;
  onComplete: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [senderReady, setSenderReady] = useState(false);
  const [templates, setTemplates] = useState<ComposerTemplate[]>([]);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [to, setTo] = useState(defaultEmail);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [selectedAttachments, setSelectedAttachments] = useState<string[]>([]);
  const [scheduledAt, setScheduledAt] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/cases/${encodeURIComponent(caseId)}/email`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as {
          sender_ready?: boolean; templates?: ComposerTemplate[]; attachments?: ComposerAttachment[]; error?: string;
        };
        if (!response.ok) throw new Error(friendlyErrorMessage(payload.error ?? "Unable to load email composer."));
        return payload;
      })
      .then((payload) => {
        if (!active) return;
        setSenderReady(Boolean(payload.sender_ready));
        setTemplates(payload.templates ?? []);
        setAttachments(payload.attachments ?? []);
      })
      .catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : "Unable to load email composer."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [caseId]);

  function chooseTemplate(id: string) {
    setSelectedTemplate(id);
    const template = templates.find((item) => item.id === id);
    if (template) {
      setSubject(template.rendered_subject);
      setBody(template.rendered_body);
      setReviewed(false);
    }
  }

  async function submit(action: "send" | "schedule") {
    if (working) return;
    if (!reviewed) { setMessage("Review and approve the final subject, recipients, and message before sending."); return; }
    setWorking(true); setMessage(null);
    const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        to: parseEmailList(to),
        cc: parseEmailList(cc),
        bcc: parseEmailList(bcc),
        subject,
        body_text: body,
        attachment_ids: selectedAttachments,
        related_action_id: null,
        idempotency_key: crypto.randomUUID(),
        override_reason: overrideReason.trim() || undefined,
        scheduled_at: action === "schedule" && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
      }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) {
      setMessage(payload.error ?? "Unable to process email.");
      setWorking(false);
      return;
    }
    setMessage(action === "send" ? "Email accepted by the provider." : "Email follow-up scheduled.");
    await onComplete();
    setWorking(false);
    if (action === "send") window.setTimeout(onClose, 700);
  }

  return (
    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div><p className="text-xs font-bold text-[#0D1B3D]">Professional email follow-up</p><p className="text-[10px] text-gray-500">Provider-backed status will appear in the case timeline.</p></div>
        <button type="button" onClick={onClose} className="text-[11px] font-bold text-gray-500">Close</button>
      </div>
      {loading ? <p className="mt-3 text-xs text-gray-400">Loading composer…</p> : !senderReady ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800">
          An approved sender identity is required before email can be sent. <a href="/settings#email-communications" className="font-bold underline">Configure email in Settings</a>.
        </div>
      ) : (
        <div className="mt-3 space-y-2.5">
          <label className="block text-[11px] font-semibold text-gray-600">Template
            <select value={selectedTemplate} onChange={(event) => chooseTemplate(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-2 text-xs">
              <option value="">Write without a template</option>
              {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
          </label>
          <label className="block text-[11px] font-semibold text-gray-600">To
            <input value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-2 text-xs" />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-[11px] font-semibold text-gray-600">CC
              <input value={cc} onChange={(event) => setCc(event.target.value)} placeholder="Optional" className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-2 text-xs" />
            </label>
            <label className="text-[11px] font-semibold text-gray-600">BCC
              <input value={bcc} onChange={(event) => setBcc(event.target.value)} placeholder="Optional" className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-2 text-xs" />
            </label>
          </div>
          <label className="block text-[11px] font-semibold text-gray-600">Subject
            <input value={subject} maxLength={300} onChange={(event) => { setSubject(event.target.value); setReviewed(false); }} className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-2 text-xs" />
          </label>
          <label className="block text-[11px] font-semibold text-gray-600">Message
            <textarea value={body} rows={9} maxLength={20000} onChange={(event) => { setBody(event.target.value); setReviewed(false); }} className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-2 text-xs leading-relaxed" />
          </label>
          {attachments.length > 0 && <details className="rounded-lg border border-gray-200 bg-white p-2">
            <summary className="cursor-pointer text-[11px] font-bold text-gray-700">Customer-visible attachments</summary>
            <div className="mt-2 space-y-1.5">{attachments.map((file) => (
              <label key={file.id} className="flex items-center gap-2 text-[11px] text-gray-600">
                <input type="checkbox" checked={selectedAttachments.includes(file.id)} onChange={(event) => setSelectedAttachments((current) => event.target.checked ? [...current, file.id] : current.filter((id) => id !== file.id))} />
                <span className="min-w-0 flex-1 truncate">{file.file_name}</span><span className="text-[10px] text-gray-400">{file.file_type}</span>
              </label>
            ))}</div>
            <p className="mt-2 text-[10px] text-gray-400">Internal-only or archived evidence is never offered here.</p>
          </details>}
          {guardrail?.warnings.length > 0 && <label className="block rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] font-semibold text-amber-800">
            {guardrail.warnings.join(" ")}<input value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Operational reason to continue" className="mt-2 w-full rounded-lg border border-amber-200 bg-white p-2 text-xs text-gray-700" />
          </label>}
          <label className="flex items-start gap-2 rounded-lg bg-white p-2 text-[11px] font-semibold text-gray-700">
            <input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
            I reviewed and approve the final recipients, subject, message, and attachments.
          </label>
          <label className="block text-[11px] font-semibold text-gray-600">Schedule for later (optional)
            <input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-2 text-xs" />
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" disabled={working || !reviewed || !subject.trim() || !body.trim()} onClick={() => void submit("send")} className="flex-1 rounded-lg bg-[#009966] px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50">{working ? "Processing…" : "Send email"}</button>
            <button type="button" disabled={working || !reviewed || !scheduledAt} onClick={() => void submit("schedule")} className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-xs font-bold text-gray-700 disabled:opacity-50">Schedule follow-up</button>
          </div>
        </div>
      )}
      {message && <p className="mt-2 text-[11px] font-semibold text-gray-700">{message}</p>}
    </div>
  );
}

function ContactControls({
  preferences,
  policy,
  disabled,
  savePreferences,
  savePolicy,
}: {
  preferences: ContactPreferenceRow | null;
  policy: ContactFrequencyPolicy;
  disabled: boolean;
  savePreferences: (input: {
    preferred_channel: CommunicationChannel | null;
    preferred_time_start: string;
    preferred_time_end: string;
    email_only: boolean;
    do_not_call: boolean;
    wrong_number: boolean;
    invalid_contact: boolean;
    do_not_email: boolean;
    email_invalid: boolean;
    email_unsubscribed: boolean;
    note: string;
  }) => Promise<{ data?: ContactPreferenceRow; error?: string }>;
  savePolicy: (input: ContactFrequencyPolicy) => Promise<{ data?: ContactFrequencyPolicy; error?: string }>;
}) {
  const [form, setForm] = useState({
    preferred_channel: preferences?.preferred_channel ?? null,
    preferred_time_start: preferences?.preferred_time_start?.slice(0, 5) ?? "",
    preferred_time_end: preferences?.preferred_time_end?.slice(0, 5) ?? "",
    email_only: preferences?.email_only ?? false,
    do_not_call: preferences?.do_not_call ?? false,
    wrong_number: preferences?.wrong_number ?? false,
    invalid_contact: preferences?.invalid_contact ?? false,
    do_not_email: preferences?.do_not_email ?? false,
    email_invalid: preferences?.email_invalid ?? false,
    email_unsubscribed: preferences?.email_unsubscribed ?? false,
    note: preferences?.note ?? "",
  });
  const [policyForm, setPolicyForm] = useState(policy);
  const [message, setMessage] = useState<string | null>(null);

  async function submitPreferences() {
    setMessage(null);
    const result = await savePreferences(form);
    setMessage(result.error ?? "Contact preferences saved.");
  }
  async function submitPolicy() {
    setMessage(null);
    const result = await savePolicy(policyForm);
    setMessage(result.error ?? "Contact policy saved.");
  }

  return (
    <details className="mt-4 rounded-xl border border-gray-200 bg-white p-3">
      <summary className="cursor-pointer text-xs font-bold text-[#0D1B3D]">Contact preferences & frequency policy</summary>
      <div className="mt-3 space-y-3">
        <label className="block text-[11px] font-semibold text-gray-600">
          Preferred channel
          <select value={form.preferred_channel ?? ""} onChange={(event) => {
            const value = event.target.value as CommunicationChannel | "";
            setForm((current) => ({ ...current, preferred_channel: value || null, email_only: value && value !== "email" ? false : current.email_only }));
          }} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-xs">
            <option value="">Not documented</option>
            {(["whatsapp", "call", "email", "portal", "other"] as CommunicationChannel[]).map((channel) => (
              <option key={channel} value={channel}>{COMMUNICATION_CHANNEL_LABELS[channel]}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] font-semibold text-gray-600">Preferred from
            <input type="time" value={form.preferred_time_start} onChange={(event) => setForm((current) => ({ ...current, preferred_time_start: event.target.value }))} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-xs" />
          </label>
          <label className="text-[11px] font-semibold text-gray-600">Preferred until
            <input type="time" value={form.preferred_time_end} onChange={(event) => setForm((current) => ({ ...current, preferred_time_end: event.target.value }))} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-xs" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {([
            ["email_only", "Email only"],
            ["do_not_call", "Do not call"],
            ["wrong_number", "Wrong number"],
            ["invalid_contact", "Invalid contact"],
            ["do_not_email", "Do not email"],
            ["email_invalid", "Invalid / bounced email"],
            ["email_unsubscribed", "Email unsubscribed"],
          ] as const).map(([field, label]) => (
            <label key={field} className="flex items-center gap-2 rounded-lg bg-gray-50 p-2 text-[11px] font-semibold text-gray-700">
              <input type="checkbox" checked={form[field]} onChange={(event) => setForm((current) => ({
                ...current,
                [field]: event.target.checked,
                ...(field === "email_only" && event.target.checked ? { preferred_channel: "email" as const } : {}),
              }))} />
              {label}
            </label>
          ))}
        </div>
        <label className="block text-[11px] font-semibold text-gray-600">Documentation note
          <textarea value={form.note} maxLength={1000} rows={2} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-xs" />
        </label>
        <button type="button" disabled={disabled} onClick={() => void submitPreferences()} className="rounded-lg bg-[#0D1B3D] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Save preferences</button>

        <details className="rounded-lg bg-gray-50 p-2">
          <summary className="cursor-pointer text-[11px] font-bold text-gray-700">Business frequency thresholds</summary>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {([
              ["max_attempts_24h", "24h"],
              ["max_attempts_7d", "7d"],
              ["max_attempts_30d", "30d"],
            ] as const).map(([field, label]) => (
              <label key={field} className="text-[10px] font-semibold text-gray-500">{label}
                <input type="number" min={1} value={policyForm[field]} onChange={(event) => setPolicyForm((current) => ({ ...current, [field]: Number(event.target.value) }))} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-xs" />
              </label>
            ))}
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <label className="text-[10px] font-semibold text-gray-500">Frequency
              <select value={policyForm.frequency_mode} onChange={(event) => setPolicyForm((current) => ({ ...current, frequency_mode: event.target.value as ContactFrequencyPolicy["frequency_mode"] }))} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-xs">
                <option value="warn">Warn</option><option value="require_override">Require override</option>
              </select>
            </label>
            <label className="text-[10px] font-semibold text-gray-500">Preferences
              <select value={policyForm.preference_mode} onChange={(event) => setPolicyForm((current) => ({ ...current, preference_mode: event.target.value as ContactFrequencyPolicy["preference_mode"] }))} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-xs">
                <option value="warn">Warn</option><option value="require_override">Require override</option>
              </select>
            </label>
            <label className="text-[10px] font-semibold text-gray-500">Bulk
              <select value={policyForm.bulk_mode} onChange={(event) => setPolicyForm((current) => ({ ...current, bulk_mode: event.target.value as ContactFrequencyPolicy["bulk_mode"] }))} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-xs">
                <option value="exclude">Exclude warned</option><option value="require_override">Allow override</option>
              </select>
            </label>
          </div>
          <button type="button" disabled={disabled} onClick={() => void submitPolicy()} className="mt-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px] font-bold text-gray-700 disabled:opacity-50">Save business policy</button>
        </details>
        {message && <p className="text-[11px] font-semibold text-gray-600">{message}</p>}
        <p className="text-[10px] text-gray-400">These are configurable operational controls, not legal determinations.</p>
      </div>
    </details>
  );
}

export function CommunicationTimeline({ activities }: { activities: CommunicationActivityRow[] }) {
  const { configuration } = useRegion();
  const visibleActivities = activities.filter((activity) =>
    !activity.metadata
    || typeof activity.metadata !== "object"
    || Array.isArray(activity.metadata)
    || activity.metadata.source !== "reminder"
  );
  if (visibleActivities.length === 0) return null;
  return (
    <SectionCard title="Communication Activity">
      <ol className="mt-2 space-y-2">
        {visibleActivities.map((activity) => (
          <li key={activity.id} className="flex gap-3 rounded-xl bg-[#F2F4F7] p-3">
            <div className="mt-0.5 text-gray-500">
              {activity.channel === "call" ? <Phone className="h-4 w-4" /> :
                activity.channel === "whatsapp" ? <MessageCircle className="h-4 w-4" /> :
                  <Mail className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-gray-800">
                {COMMUNICATION_CHANNEL_LABELS[activity.channel]} · {activity.direction}
              </p>
              <p className="text-[11px] text-gray-500">
                {activity.outcome && activity.channel === "call"
                  ? CALL_OUTCOME_LABELS[activity.outcome as CallOutcome] ?? activity.outcome.replaceAll("_", " ")
                  : COMMUNICATION_STATUS_LABELS[activity.status]}
              </p>
              <p className="mt-0.5 text-[10px] text-gray-400">{formatTimestamp(activity.completed_at ?? activity.started_at, configuration.settings)}</p>
            </div>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}
