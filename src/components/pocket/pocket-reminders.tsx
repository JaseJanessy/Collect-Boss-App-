"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CalendarClock, MessageCircle, WalletCards } from "lucide-react";
import { formatCurrencyMinor } from "@/lib/financial/money";
import { createJsonService } from "@/lib/pocket/client-service";
import type { PocketReminderLanguage, PocketReminderTemplateKey } from "@/lib/pocket/reminders";
import { PocketEmptyState, PocketUnavailable } from "./pocket-states";
import { pocketPrimaryActionClass, pocketSecondaryActionClass } from "./pocket-ui";

const primary = pocketPrimaryActionClass;
const secondary = pocketSecondaryActionClass;

type Card = {
  id: string; debtId: string | null; invoiceId: string | null; customerId: string; customerName: string; phoneAvailable: boolean;
  amountMinor: number; currency: string; dueDate: string | null; dueState: string;
  eventType: string; group: "today" | "overdue" | "payments"; template: PocketReminderTemplateKey; language: PocketReminderLanguage;
};
type Feed = {
  summary: { dueTodayCustomerCount: number; dueTodayTotalMinor: number; currency: string };
  groups: { today: Card[]; overdue: Card[]; payments: Card[]; system: Card[] };
  history: Array<{ id: string; debtId: string; customerId: string; customerName: string; amountMinor: number; currency: string; eventType: "prepared" | "opened_to_whatsapp"; template: string; language: string; createdAt: string }>;
};

const api = createJsonService({ fallbackMessage: "Reminder request failed.", cache: "no-store" });

export function PocketReminderCentre() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => api<Feed>("/api/pocket/reminders").then(setFeed).catch(() => setFailed(true)), []);
  useEffect(() => { void load(); }, [load]);
  async function preference(debtId: string, action: "snooze" | "disable") {
    await api("/api/pocket/reminders", { method: "PATCH", body: JSON.stringify({ debtId, action, ...(action === "snooze" ? { hours: 24 } : {}) }) });
    await load();
  }
  if (failed) return <PocketUnavailable />;
  if (!feed) return <p role="status" className="py-12 text-center text-sm font-semibold text-slate-500">Loading reminders…</p>;
  const sections = [
    { id: "today", title: "Today", icon: CalendarClock, cards: feed.groups.today },
    { id: "overdue", title: "Overdue", icon: Bell, cards: feed.groups.overdue },
    { id: "payments", title: "Payments", icon: WalletCards, cards: feed.groups.payments },
    { id: "system", title: "System", icon: Bell, cards: feed.groups.system },
  ] as const;
  return <div>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-3xl border border-emerald-950/10 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-slate-500">Due Today</p>
        <p className="mt-2 text-3xl font-black text-[#092F2A]">{feed.summary.dueTodayCustomerCount}</p>
        <p className="mt-1 text-sm font-bold text-[#087F5B]">{formatCurrencyMinor(feed.summary.dueTodayTotalMinor, feed.summary.currency)}</p>
      </div>
      <div className="rounded-3xl bg-emerald-50 p-5 text-sm leading-6 text-emerald-950">
        <strong>You stay in control.</strong> Pocket prepares polite text. WhatsApp opens for your review, and only you can tap Send.
      </div>
    </div>
    <div className="mt-7 space-y-8">
      {sections.map(({ id, title, icon: Icon, cards }) => <section key={id} aria-labelledby={`reminder-${id}`}>
        <h2 id={`reminder-${id}`} className="flex items-center gap-2 text-xl font-black text-[#092F2A]"><Icon className="size-5 text-[#087F5B]" aria-hidden="true"/>{title}</h2>
        <div className="mt-3 space-y-3">
          {cards.length ? cards.map((card) => <article key={card.id} className="rounded-3xl border border-emerald-950/10 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><h3 className="font-black text-[#092F2A]">{card.customerName}</h3><p className="mt-1 text-sm text-slate-500">{card.dueState}{card.dueDate ? ` · ${card.dueDate}` : ""}</p></div>
              <p className="font-black text-[#092F2A]">{formatCurrencyMinor(card.amountMinor, card.currency)}</p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {card.invoiceId ? <Link className={primary} href={`/pocket/invoices/${card.invoiceId}`}>Review Invoice</Link> : <><Link className={primary} href={`/pocket/reminders/compose?debtId=${card.debtId}&template=${card.template}&language=${card.language}`}><MessageCircle className="mr-2 size-4" aria-hidden="true"/>Send Reminder</Link><button className={secondary} onClick={() => card.debtId ? void preference(card.debtId, "snooze") : undefined}>Snooze 24h</button><button className={secondary} onClick={() => card.debtId ? void preference(card.debtId, "disable") : undefined}>Disable</button></>}
            </div>
          </article>) : <p className="rounded-2xl bg-white p-4 text-sm text-slate-500">No {title.toLowerCase()} reminders.</p>}
        </div>
      </section>)}
    </div>
    <section className="mt-9" aria-labelledby="reminder-history"><h2 id="reminder-history" className="text-xl font-black text-[#092F2A]">Reminder history</h2>
      {feed.history.length ? <div className="mt-3 space-y-2">{feed.history.map((event) => <p key={event.id} className="rounded-2xl bg-white p-4 text-sm text-slate-600"><strong>{event.eventType === "prepared" ? "Reminder Prepared" : "Opened to WhatsApp"}</strong> · {event.customerName} · {formatCurrencyMinor(event.amountMinor,event.currency)} · {new Date(event.createdAt).toLocaleString()} · {event.language.toUpperCase()}</p>)}</div>
        : <p className="mt-3 text-sm text-slate-500">No reminder handoffs recorded yet.</p>}
    </section>
  </div>;
}

type Prepared = {
  preparedEventId: string; message: string; customerName: string; phoneAvailable: boolean;
  warnings: string[]; requiresConfirmation: boolean; recommendedAction: string; deliveryStatus: "not_sent";
};

export function PocketReminderComposer({ debtId, scheduleId, initialTemplate = "gentle", initialLanguage = "en" }: {
  debtId?: string; scheduleId?: string; initialTemplate?: PocketReminderTemplateKey; initialLanguage?: PocketReminderLanguage;
}) {
  const [template, setTemplate] = useState<PocketReminderTemplateKey>(initialTemplate);
  const [language, setLanguage] = useState<PocketReminderLanguage>(initialLanguage);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const prepareKey = useRef(crypto.randomUUID());
  const openKey = useRef(crypto.randomUUID());
  const requestSignature = useRef("");
  useEffect(() => {
    let active = true;
    const signature = JSON.stringify({ debtId, scheduleId, template, language });
    if (requestSignature.current !== signature) {
      requestSignature.current = signature;
      prepareKey.current = crypto.randomUUID();
      openKey.current = crypto.randomUUID();
    }
    void api<Prepared>("/api/pocket/reminders/compose", {
      method: "POST", headers: { "Idempotency-Key": prepareKey.current },
      body: JSON.stringify({ action: "prepare", debtId, scheduleId, template, language }),
    }).then((result) => {
      if (!active) return;
      setError(""); setPrepared(result); setMessage(result.message); setConfirmed(false);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "The reminder could not be prepared.");
    });
    return () => { active = false; };
  }, [debtId, scheduleId, template, language]);
  async function openWhatsApp() {
    setBusy(true); setError("");
    try {
      const result = await api<{ deepLink: string; handoffStatus: string; deliveryStatus: string }>("/api/pocket/reminders/compose", {
        method: "POST", headers: { "Idempotency-Key": openKey.current },
        body: JSON.stringify({ action: "open_whatsapp", debtId, scheduleId, template, language, editedMessage: message, confirmGuardWarnings: confirmed }),
      });
      window.location.assign(result.deepLink);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "WhatsApp could not be opened."); openKey.current = crypto.randomUUID(); }
    finally { setBusy(false); }
  }
  if (!prepared && !error) return <p role="status" className="py-12 text-center text-sm font-semibold text-slate-500">Preparing trusted reminder details…</p>;
  return <div className="mx-auto max-w-2xl">
    <div className="rounded-3xl border border-emerald-950/10 bg-white p-6 shadow-sm sm:p-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-bold text-[#092F2A]">Language<select className="mt-2 min-h-12 w-full rounded-2xl border border-slate-300 px-4" value={language} onChange={(event) => setLanguage(event.target.value as PocketReminderLanguage)}><option value="en">English</option><option value="ms">Malay</option><option value="zh">Chinese</option></select></label>
        <label className="text-sm font-bold text-[#092F2A]">Template<select className="mt-2 min-h-12 w-full rounded-2xl border border-slate-300 px-4" value={template} onChange={(event) => setTemplate(event.target.value as PocketReminderTemplateKey)}><option value="gentle">Gentle Reminder</option><option value="due_today">Due Today</option><option value="overdue">Overdue Reminder</option><option value="partial_balance">Partial Payment Balance</option></select></label>
      </div>
      {prepared ? <label className="mt-5 block text-sm font-bold text-[#092F2A]">Preview and edit<textarea className="mt-2 min-h-44 w-full rounded-2xl border border-slate-300 p-4 text-base leading-7" maxLength={1200} value={message} onChange={(event) => setMessage(event.target.value)}/></label> : null}
      {prepared?.warnings.length ? <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-950"><strong>Contact notes to review</strong><ul className="mt-2 list-disc pl-5">{prepared.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>{prepared.requiresConfirmation ? <label className="mt-3 flex items-start gap-2"><input className="mt-1" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}/><span>I reviewed these documented warnings and still want to open WhatsApp.</span></label> : null}</div> : null}
      {error ? <p role="alert" className="mt-4 rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-800">{error}</p> : null}
      <p className="mt-5 text-sm leading-6 text-slate-500">Opening WhatsApp records only the handoff. Pocket does not claim the message was sent, delivered, or read.</p>
      <div className="mt-5 flex flex-wrap gap-3"><button className={primary} disabled={busy || !prepared || !message.trim() || (prepared.requiresConfirmation && !confirmed)} onClick={() => void openWhatsApp()}><MessageCircle className="mr-2 size-4"/>{busy ? "Opening…" : "Open WhatsApp"}</button><Link className={secondary} href="/pocket/reminders">Back to Reminders</Link></div>
    </div>
  </div>;
}

export function PocketReminderEmpty() {
  return <PocketEmptyState title="No reminders today" message="Pocket will show due and overdue balances here without sending customer messages automatically."/>;
}
