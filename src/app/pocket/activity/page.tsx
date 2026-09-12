import Link from "next/link";
import { Bell, ChartNoAxesColumn, ReceiptText } from "lucide-react";

import { pocketDestinations } from "@collectboss/pocket-navigation";
import { PocketPaymentActivity } from "@/components/pocket/pocket-payments";
import { PocketPageHeader } from "@/components/pocket/pocket-ui";

const iconById = { reminders: Bell, receipts: ReceiptText, "basic-reports": ChartNoAxesColumn };

export default function PocketActivityPage() {
  const destinations = pocketDestinations.filter((item) => item.owner === "activity");
  return (
    <section aria-labelledby="pocket-activity-title">
      <PocketPageHeader id="pocket-activity-title" eyebrow="Recent updates" title="Activity" description="Payments, receipts, and reminders in one simple timeline." />
      <nav aria-label="Activity views" className="mt-5 flex gap-2 overflow-x-auto pb-2">
        {destinations.map((item) => {const Icon=iconById[item.id as keyof typeof iconById];return <Link key={item.id} href={item.href} className="pocket-secondary-action shrink-0">{Icon?<Icon aria-hidden="true" className="size-4"/>:null}{item.label}</Link>;})}
      </nav>
      <PocketPaymentActivity />
    </section>
  );
}
