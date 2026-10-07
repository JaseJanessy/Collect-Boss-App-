"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { requestJson } from "@/lib/data/http-service";
import { ALLOWED_DAY_OFFSETS, offsetLabel } from "@/lib/whatsapp/policy";

interface Payload {
  available: boolean;
  paidPlan: boolean;
  policy: { enabled: boolean; dayOffsets: number[]; language: "en" | "ms"; consentAttestedAt: string | null };
  recent: Array<{ id: string; template_kind: string; status: string; skip_reason: string | null; error_message: string | null; local_send_date: string; customerName: string; amount: string }>;
}

const SHOWN_OFFSETS = ALLOWED_DAY_OFFSETS.filter((offset) => [-3, -1, 0, 3, 7, 14, 30].includes(offset));

const STATUS_TEXT: Record<string, string> = {
  queued: "Waiting", sending: "Sending", sent: "Sent", delivered: "Delivered", read: "Read", failed: "Not delivered", skipped: "Not sent",
};

const SKIP_TEXT: Record<string, string> = {
  customer_opted_out: "customer replied STOP",
  wrong_number: "marked wrong number",
  invalid_contact: "contact marked invalid",
  email_only: "customer prefers email",
  nothing_outstanding: "already paid",
  not_collectable: "invoice closed",
};

/** Settings for automatic WhatsApp payment reminders. */
export function WhatsAppRemindersPanel({ canManage }: { canManage: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<Payload["policy"] | null>(null);
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await requestJson<Payload>("/api/whatsapp-reminders", { cache: "no-store" });
      setData(payload);
      setDraft(payload.policy);
    } catch (cause) {
      setMessage({ tone: "error", text: cause instanceof Error ? cause.message : "We couldn't load WhatsApp reminders." });
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setMessage(null);
    try {
      await requestJson("/api/whatsapp-reminders", {
        method: "PUT",
        body: JSON.stringify({ ...draft, consentConfirmed: consent || undefined }),
      }, "We couldn't save the reminder settings.");
      setMessage({ tone: "ok", text: draft.enabled ? "Saved. Reminders go out automatically between 9am and 8pm." : "Saved. Automatic reminders are off." });
      setConsent(false);
      await load();
    } catch (cause) {
      setMessage({ tone: "error", text: cause instanceof Error ? cause.message : "We couldn't save the reminder settings." });
    } finally {
      setSaving(false);
    }
  }

  if (!data || !draft) {
    return <p className="mt-2 text-xs text-gray-500">{message?.text ?? "Loading…"}</p>;
  }

  const needsConsent = draft.enabled && !data.policy.consentAttestedAt;
  const disabled = !canManage || !data.available || !data.paidPlan;

  return (
    <div className="mt-1 flex flex-col gap-4">
      <p className="text-xs text-gray-500">
        CollectBoss sends polite payment reminders to your customers on WhatsApp from our verified business number, on the days you choose. Customers can reply STOP at any time.
      </p>
      {!data.available && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Automatic WhatsApp sending is being set up and will be available soon. You can still send reminders yourself from each case.</p>}
      {data.available && !data.paidPlan && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
          Automatic WhatsApp reminders are included in paid plans. <Link href="/billing" className="underline">See plans</Link>
        </p>
      )}

      <label className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-3 py-3">
        <span className="flex items-center gap-2 text-sm font-bold text-gray-800"><MessageCircle className="h-4 w-4 text-emerald-700" aria-hidden="true" />Send reminders automatically</span>
        <input type="checkbox" className="h-5 w-5 accent-[#009966]" checked={draft.enabled} disabled={disabled}
          onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
      </label>

      <fieldset disabled={disabled}>
        <legend className="text-xs font-bold text-gray-700">When to remind</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {SHOWN_OFFSETS.map((offset) => {
            const selected = draft.dayOffsets.includes(offset);
            return (
              <button key={offset} type="button" aria-pressed={selected}
                onClick={() => setDraft({ ...draft, dayOffsets: selected ? draft.dayOffsets.filter((value) => value !== offset) : [...draft.dayOffsets, offset] })}
                className={`min-h-10 rounded-xl border px-3 text-xs font-semibold ${selected ? "border-[#009966] bg-[#E8F7F2] text-[#0D1B3D]" : "border-gray-200 bg-white text-gray-600"}`}>
                {offsetLabel(offset)}
              </button>
            );
          })}
        </div>
      </fieldset>

      <label className="text-xs font-bold text-gray-700">Message language
        <select value={draft.language} disabled={disabled} onChange={(event) => setDraft({ ...draft, language: event.target.value as "en" | "ms" })}
          className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal">
          <option value="en">English</option>
          <option value="ms">Bahasa Malaysia</option>
        </select>
      </label>

      {needsConsent && (
        <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
          <input type="checkbox" className="mt-0.5" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          I confirm my customers agreed to receive payment reminders from my business on WhatsApp, and I will stop if they ask.
        </label>
      )}

      {canManage && (
        <button type="button" onClick={() => void save()} disabled={saving || disabled || (needsConsent && !consent) || draft.dayOffsets.length === 0}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#009966] px-4 text-sm font-bold text-white disabled:opacity-50">
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Save reminder settings
        </button>
      )}
      {message && <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-sm text-red-700" : "text-sm text-emerald-700"}>{message.text}</p>}

      {data.recent.length > 0 && (
        <div>
          <p className="text-xs font-bold text-gray-700">Recent reminders</p>
          <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-100">
            {data.recent.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                <span className="min-w-0 truncate text-gray-700">{item.customerName} · {item.amount}</span>
                <span className={item.status === "failed" ? "shrink-0 font-semibold text-red-700" : "shrink-0 font-semibold text-gray-500"}>
                  {STATUS_TEXT[item.status] ?? item.status}{item.skip_reason ? ` (${SKIP_TEXT[item.skip_reason] ?? item.skip_reason})` : ""} · {item.local_send_date}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
