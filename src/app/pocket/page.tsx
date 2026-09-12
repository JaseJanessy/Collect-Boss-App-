import Link from "next/link";
import { ArrowUpRight, CalendarClock, HandCoins, ScanLine, Users } from "lucide-react";

import { pocketDestinations } from "@collectboss/pocket-navigation";
import { PocketHomeLedger } from "@/components/pocket/pocket-ledger";
import { PocketPageHeader } from "@/components/pocket/pocket-ui";

const iconById = {
  "add-debt": HandCoins,
  "record-payment": CalendarClock,
  "scan-receipt": ScanLine,
  "who-owes-me": Users,
};

export default function PocketHomePage() {
  const actions = pocketDestinations.filter((item) => Object.hasOwn(iconById, item.id));
  return (
    <section aria-labelledby="pocket-home-title" className="space-y-6">
      <PocketPageHeader id="pocket-home-title" eyebrow="CollectBoss Pocket" title="Today" description="See what needs attention, then take one clear action." />
      <PocketHomeLedger>
        <section aria-labelledby="pocket-quick-actions-title">
          <div className="flex items-center justify-between gap-4">
            <h2 id="pocket-quick-actions-title" className="text-lg font-black text-[#082C32] sm:text-xl">Quick actions</h2>
            <span className="hidden text-xs font-bold uppercase tracking-[0.16em] text-[#647773] sm:block">Choose one</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            {actions.map((item) => {
              const Icon = iconById[item.id as keyof typeof iconById];
              return (
                <Link key={item.id} href={item.href} aria-label={`${item.label}. ${item.description}`} data-pocket-action={item.id} className="pocket-action-tile group">
                  <span className="flex items-start justify-between gap-3">
                    <span className="pocket-action-icon flex size-12 items-center justify-center rounded-[1.1rem]"><Icon aria-hidden="true" className="size-6" /></span>
                    <ArrowUpRight aria-hidden="true" className="size-5 text-[var(--pocket-muted)] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none" />
                  </span>
                  <span>
                    <span className="block text-[0.95rem] font-black leading-tight text-[var(--pocket-ink)] sm:text-base">{item.label}</span>
                    <span className="mt-1 hidden text-xs leading-5 text-[var(--pocket-muted)] sm:block">{item.description}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      </PocketHomeLedger>
    </section>
  );
}
