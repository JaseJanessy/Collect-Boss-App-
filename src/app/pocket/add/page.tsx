import Link from "next/link";
import { HandCoins, ScanLine, WalletCards } from "lucide-react";

import { pocketDestinations } from "@collectboss/pocket-navigation";
import { PocketInvoiceEntry } from "@/components/pocket/pocket-invoices";
import { PocketPageHeader } from "@/components/pocket/pocket-ui";

const iconById = { "add-debt": HandCoins, "record-payment": WalletCards, "scan-receipt": ScanLine };

export default function PocketAddPage() {
  const actions = pocketDestinations.filter((item) => item.owner === "add");
  return (
    <section aria-labelledby="pocket-add-title" className="mx-auto max-w-5xl space-y-6">
      <PocketPageHeader id="pocket-add-title" eyebrow="One thing at a time" title="Add" description="Choose what you want to record." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {actions.map((item) => {
          const Icon=iconById[item.id as keyof typeof iconById];
          return <Link key={item.id} href={item.href} data-pocket-action={item.id} className="pocket-action-tile"><span className="pocket-action-icon flex size-12 items-center justify-center rounded-2xl">{Icon?<Icon aria-hidden="true" className="size-6"/>:null}</span><span><span className="block font-black text-[var(--pocket-ink)]">{item.label}</span><span className="mt-1 hidden text-xs leading-5 text-[var(--pocket-muted)] sm:block">{item.description}</span></span></Link>;
        })}
        <PocketInvoiceEntry />
      </div>
    </section>
  );
}
