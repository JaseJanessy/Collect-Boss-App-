import Link from "next/link";
import { Bell, ChartNoAxesColumn, ChevronRight, FileText, ReceiptText, Settings, Sparkles, WalletCards } from "lucide-react";

import { pocketDestinations } from "@collectboss/pocket-navigation";
import { PocketPageHeader } from "@/components/pocket/pocket-ui";
import { PocketAccountActions } from "@/components/pocket/pocket-account-actions";

const iconById = { "simple-invoices":FileText, "basic-reports":ChartNoAxesColumn, settings:Settings, receipts:ReceiptText, reminders:Bell, "plan-limits":WalletCards, "upgrade-solo":Sparkles };

export default function PocketMorePage() {
  const destinations = pocketDestinations.filter((item) => Object.hasOwn(iconById,item.id));
  return (
    <section aria-labelledby="pocket-more-title" className="mx-auto max-w-3xl">
      <PocketPageHeader id="pocket-more-title" eyebrow="Pocket tools" title="More" description="Settings and occasional tools stay out of your daily workflow." />
      <div className="pocket-card mt-6 overflow-hidden">{destinations.map((item) => {const Icon=iconById[item.id as keyof typeof iconById];return <Link key={item.id} href={item.href} className="flex min-h-18 items-center gap-4 border-b border-[#e6eee9] px-4 py-3 last:border-b-0 hover:bg-emerald-50/60 sm:px-5"><span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#DFF7EF] text-[#087F5B]"><Icon aria-hidden="true" className="size-5"/></span><span className="min-w-0 flex-1"><span className="block font-black text-[#082C32]">{item.label}</span><span className="mt-0.5 block text-xs leading-5 text-[#536866]">{item.description}</span></span><ChevronRight aria-hidden="true" className="size-5 shrink-0 text-[#7c918a]"/></Link>;})}</div>
      <PocketAccountActions />
    </section>
  );
}
