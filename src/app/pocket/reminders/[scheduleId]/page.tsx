import { PocketReminderComposer } from "@/components/pocket/pocket-reminders";

export default async function PocketScheduledReminderPage({ params }: { params: Promise<{ scheduleId: string }> }) {
  const { scheduleId } = await params;
  return <section aria-labelledby="scheduled-reminder-title">
    <p className="text-sm font-bold text-[#087F5B]">Owner notification</p>
    <h1 id="scheduled-reminder-title" className="mt-2 text-3xl font-black text-[#092F2A]">Review Reminder</h1>
    <p className="mt-2 text-sm leading-6 text-slate-500">This link opens only after Pocket verifies the schedule belongs to your signed-in business.</p>
    <div className="mt-7"><PocketReminderComposer scheduleId={scheduleId}/></div>
  </section>;
}
