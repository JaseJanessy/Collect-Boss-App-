import { PocketBillingPanel } from "@/components/pocket/pocket-billing-panel";

export default function PocketBillingPage() {
  return (
    <section aria-labelledby="pocket-billing-title" className="mx-auto max-w-3xl">
      <p className="text-sm font-bold text-[#087F5B]">Pocket account</p>
      <h1 id="pocket-billing-title" className="mt-2 text-3xl font-black text-[#092F2A] sm:text-4xl">Plan &amp; Limits</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">Your live billing cycle and server-verified usage. Counters shown here are informational; every action is checked again on the server.</p>
      <PocketBillingPanel />
    </section>
  );
}
