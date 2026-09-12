import { PocketReminderCentre } from "@/components/pocket/pocket-reminders";
import { PocketPageHeader } from "@/components/pocket/pocket-ui";

export default function PocketRemindersPage() {
  return <section aria-labelledby="pocket-reminders-title"><PocketPageHeader id="pocket-reminders-title" eyebrow="Follow up" title="Reminders" description="Choose a customer and prepare the right WhatsApp message."/><PocketReminderCentre/></section>;
}
