"use client";

import { useCallback, useEffect, useState } from "react";
import { Mail, ShieldCheck } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import type { EmailSenderIdentityRow, EmailTemplateRow } from "@/lib/supabase/types";

interface EmailOperations {
  health: { status: string; actionable_message: string | null; consecutive_failures: number } | null;
  suppressions: Array<{ id: string; masked_recipient: string; reason: string; created_at: string }>;
  jobs: Array<{ id: string; status: "retry_scheduled" | "dead_letter"; attempts: number; max_attempts: number; last_error_message: string | null }>;
}

export function EmailCommunicationsPanel() {
  const [identity, setIdentity] = useState<EmailSenderIdentityRow | null>(null);
  const [templates, setTemplates] = useState<EmailTemplateRow[]>([]);
  const [form, setForm] = useState({ from_email: "", from_name: "", reply_domain: "", signature_text: "" });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [operations, setOperations] = useState<EmailOperations>({ health: null, suppressions: [], jobs: [] });

  const load = useCallback(async () => {
    const response = await fetch("/api/email/settings", { cache: "no-store" });
    const payload = await response.json() as { identity?: EmailSenderIdentityRow | null; templates?: EmailTemplateRow[]; error?: string; health?: EmailOperations["health"]; suppressions?: EmailOperations["suppressions"]; jobs?: EmailOperations["jobs"] };
    if (!response.ok) throw new Error(payload.error ?? "Unable to load email settings.");
    const current = payload.identity ?? null;
    setIdentity(current);
    setTemplates(payload.templates ?? []);
    setOperations({ health: payload.health ?? null, suppressions: payload.suppressions ?? [], jobs: payload.jobs ?? [] });
    if (current) setForm({
      from_email: current.from_email,
      from_name: current.from_name,
      reply_domain: current.reply_domain ?? "",
      signature_text: current.signature_text,
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Unable to load email settings."))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function saveIdentity() {
    setWorking(true); setMessage(null);
    const response = await fetch("/api/email/settings", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
    });
    const payload = await response.json() as { identity?: EmailSenderIdentityRow; error?: string };
    if (!response.ok || !payload.identity) setMessage(payload.error ?? "Unable to save sender identity.");
    else {
      setIdentity(payload.identity);
      setMessage(payload.identity.verification_status === "verified"
        ? "Sender domain verified. Email sending is enabled."
        : payload.identity.last_verification_error ?? "Sender identity saved but not verified.");
    }
    setWorking(false);
  }

  async function saveTemplate(template: EmailTemplateRow) {
    setWorking(true); setMessage(null);
    const response = await fetch("/api/email/settings", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(template),
    });
    const payload = await response.json() as { template?: EmailTemplateRow; error?: string };
    setMessage(response.ok ? "Email template saved." : payload.error ?? "Unable to save email template.");
    if (payload.template) setTemplates((current) => current.map((item) => item.id === payload.template!.id ? payload.template! : item));
    setWorking(false);
  }

  async function replay(jobId: string) {
    const reason = window.prompt("Why is this email safe to replay?", "Sender and suppression status reviewed; retry with the existing idempotency key.");
    if (!reason) return;
    setWorking(true);
    const response = await fetch(`/api/integrations/jobs/${jobId}/replay`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }),
    });
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    setMessage(response.ok ? "Email retry queued safely." : payload?.error?.message ?? "Email retry could not be queued.");
    if (response.ok) await load();
    setWorking(false);
  }

  return (
    <div id="email-communications">
      <SectionCard title="Email Communications">
        <div className="mt-2 flex items-start gap-2 rounded-xl bg-[#F2F4F7] p-3">
          <Mail className="mt-0.5 h-4 w-4 text-[#009966]" />
          <div><p className="text-xs font-bold text-gray-800">Approved sender identity</p><p className="text-[10px] leading-relaxed text-gray-500">Email remains available inside case Follow Up and Timeline. Messages cannot send until the provider verifies this domain.</p></div>
        </div>
        {loading ? <p className="mt-3 text-xs text-gray-400">Loading email settings…</p> : <div className="mt-3 space-y-2.5">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-[11px] font-semibold text-gray-600">Sender name<input value={form.from_name} onChange={(event) => setForm((current) => ({ ...current, from_name: event.target.value }))} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-xs" /></label>
            <label className="text-[11px] font-semibold text-gray-600">Sender email<input type="email" value={form.from_email} onChange={(event) => setForm((current) => ({ ...current, from_email: event.target.value }))} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-xs" /></label>
          </div>
          <label className="block text-[11px] font-semibold text-gray-600">Inbound reply domain (optional)<input value={form.reply_domain} onChange={(event) => setForm((current) => ({ ...current, reply_domain: event.target.value }))} placeholder="replies.example.com" className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-xs" /><span className="mt-1 block text-[10px] font-normal text-gray-400">Configure this as a provider receiving domain to link replies automatically.</span></label>
          <label className="block text-[11px] font-semibold text-gray-600">Business signature<textarea value={form.signature_text} maxLength={4000} rows={4} onChange={(event) => setForm((current) => ({ ...current, signature_text: event.target.value }))} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-xs" /></label>
          <div className="flex items-center justify-between gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${identity?.verification_status === "verified" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}><ShieldCheck className="h-3 w-3" />{identity?.verification_status === "verified" ? "Verified" : "Not verified"}</span>
            <button type="button" disabled={working || !form.from_email || !form.from_name} onClick={() => void saveIdentity()} className="rounded-lg bg-[#0D1B3D] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Verify & save</button>
          </div>
        </div>}
        {templates.length > 0 && <details className="mt-4 rounded-xl border border-gray-200 p-3">
          <summary className="cursor-pointer text-xs font-bold text-[#0D1B3D]">Editable reminder templates</summary>
          <div className="mt-3 space-y-3">{templates.map((template) => (
            <details key={template.id} className="rounded-lg bg-gray-50 p-2">
              <summary className="cursor-pointer text-[11px] font-bold text-gray-700">{template.name}</summary>
              <div className="mt-2 space-y-2">
                <input value={template.name} onChange={(event) => setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, name: event.target.value } : item))} className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs" />
                <input value={template.subject_template} onChange={(event) => setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, subject_template: event.target.value } : item))} className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs" />
                <textarea value={template.body_template} rows={7} onChange={(event) => setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, body_template: event.target.value } : item))} className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs" />
                <label className="flex items-center gap-2 text-[11px] font-semibold text-gray-600"><input type="checkbox" checked={template.is_active} onChange={(event) => setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, is_active: event.target.checked } : item))} />Available in composer</label>
                <button type="button" disabled={working} onClick={() => void saveTemplate(template)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px] font-bold text-gray-700">Save template</button>
              </div>
            </details>
          ))}</div>
          <p className="mt-2 text-[10px] text-gray-400">Variables: customer_name, invoice_number, due_date, outstanding_amount, payment_link, business_signature.</p>
        </details>}
        <div className="mt-4 rounded-xl border border-gray-200 p-3 text-[11px]">
          <p className="font-bold text-[#0D1B3D]">Delivery health: {operations.health?.status?.replace("_", " ") ?? "unknown"}</p>
          {operations.health?.actionable_message && <p className="mt-1 text-amber-700">{operations.health.actionable_message}</p>}
          {operations.jobs.map((job) => <div key={job.id} className="mt-2 rounded-lg bg-amber-50 p-2 text-amber-900">
            <p className="font-bold">{job.status === "dead_letter" ? "Delivery needs manual review" : "Delivery retry scheduled"} · {job.attempts}/{job.max_attempts}</p>
            {job.last_error_message && <p className="mt-1">{job.last_error_message}</p>}
            <button type="button" disabled={working} onClick={() => void replay(job.id)} className="mt-2 rounded-lg border border-amber-300 bg-white px-2 py-1 font-bold disabled:opacity-50">Replay safely</button>
          </div>)}
          {operations.suppressions.length > 0 && <details className="mt-2"><summary className="cursor-pointer font-bold text-gray-700">Suppressed recipients ({operations.suppressions.length})</summary>
            <ul className="mt-1 space-y-1">{operations.suppressions.map((item) => <li key={item.id}>{item.masked_recipient} · {item.reason.replace("_", " ")}</li>)}</ul>
          </details>}
        </div>
        {message && <p className="mt-3 text-[11px] font-semibold text-gray-600">{message}</p>}
      </SectionCard>
    </div>
  );
}
