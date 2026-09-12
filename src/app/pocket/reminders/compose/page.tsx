import { PocketReminderComposer } from "@/components/pocket/pocket-reminders";
import type { PocketReminderLanguage, PocketReminderTemplateKey } from "@/lib/pocket/reminders";

const templates = new Set<PocketReminderTemplateKey>(["gentle", "due_today", "overdue", "partial_balance"]);
const languages = new Set<PocketReminderLanguage>(["en", "ms", "zh"]);

export default async function PocketReminderComposePage({ searchParams }: {
  searchParams: Promise<{ debtId?: string; scheduleId?: string; template?: string; language?: string }>;
}) {
  const values = await searchParams;
  const template = templates.has(values.template as PocketReminderTemplateKey) ? values.template as PocketReminderTemplateKey : "gentle";
  const language = languages.has(values.language as PocketReminderLanguage) ? values.language as PocketReminderLanguage : "en";
  return <section aria-labelledby="reminder-compose-title">
    <p className="text-sm font-bold text-[#087F5B]">User-confirmed handoff</p>
    <h1 id="reminder-compose-title" className="mt-2 text-3xl font-black text-[#092F2A]">Prepare WhatsApp Reminder</h1>
    <p className="mt-2 text-sm leading-6 text-slate-500">Review the trusted balance and customer details before opening WhatsApp.</p>
    <div className="mt-7"><PocketReminderComposer debtId={values.debtId} scheduleId={values.scheduleId} initialTemplate={template} initialLanguage={language}/></div>
  </section>;
}
