import Link from "next/link";
import type { PocketDestination } from "@collectboss/pocket-navigation";

export function PocketPlaceholder({ destination }: { destination: PocketDestination }) {
  return (
    <section aria-labelledby="pocket-placeholder-title" className="mx-auto max-w-2xl">
      <p className="text-sm font-bold text-[var(--pocket-action-primary)]">CollectBoss Pocket</p>
      <h1 id="pocket-placeholder-title" className="mt-2 text-3xl font-black tracking-tight text-[var(--pocket-ink)] sm:text-4xl">{destination.label}</h1>
      <div className="pocket-card mt-6 p-6 sm:p-8">
        <p className="text-base leading-7 text-slate-700">{destination.description}</p>
        <p className="mt-3 text-sm leading-6 text-slate-500">This destination is securely connected to your signed-in Pocket business.</p>
        <Link href="/pocket" className="pocket-secondary-action mt-6">
          Back to Home
        </Link>
      </div>
    </section>
  );
}
