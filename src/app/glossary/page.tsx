import type { Metadata } from "next";
import Link from "next/link";

import { CollectBossWordmark } from "@/components/brand/wordmark";

export const metadata: Metadata = {
  title: "Beginner Glossary",
  description: "Plain-language definitions for common CollectBoss recovery and payment terms.",
  robots: { index: true, follow: true },
};

const terms = [
  ["Customer", "Your commercial relationship record. A customer becomes a debtor when a recovery workflow starts."],
  ["Debtor", "The person or organisation that owes an amount being recovered."],
  ["Case", "A controlled recovery workflow for one debtor and the amounts selected for recovery."],
  ["Receivable", "An amount owed, whether it comes from an invoice or another obligation."],
  ["Payment Proof", "Evidence supporting a claimed payment. It is not a confirmed payment or a receipt."],
  ["Receipt", "A record issued after a payment has been confirmed and applied."],
  ["Promise to Pay", "One commitment to pay a stated amount by a stated date."],
  ["Payment Plan", "An agreed schedule of multiple instalments."],
  ["Dispute", "A recorded challenge to all or part of an amount owed, with a review history."],
  ["Formal Demand", "A formal payment demand produced from case records. It is not legal advice or a court filing."],
  ["Legal Handoff", "A controlled transfer of case information to an authorised legal professional for independent review."],
] as const;

export default function GlossaryPage() {
  return (
    <div className="min-h-screen bg-[#F2F4F7]">
      <header className="border-b border-gray-100 bg-white px-5 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between"><Link href="/"><CollectBossWordmark /></Link><Link href="/support" className="text-sm font-bold text-[#007A52] hover:underline">Support</Link></div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-12">
        <p className="text-xs font-bold uppercase tracking-widest text-[#009966]">Beginner guide</p>
        <h1 className="mt-2 text-3xl font-black text-[#0D1B3D]">CollectBoss glossary</h1>
        <p className="mt-3 text-base leading-relaxed text-gray-600">Clear definitions for the recovery, payment and evidence terms used throughout the product.</p>
        <dl className="mt-8 divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white px-5">
          {terms.map(([term, meaning]) => <div key={term} className="py-5"><dt className="font-black text-[#0D1B3D]">{term}</dt><dd className="mt-1 text-sm leading-relaxed text-gray-600">{meaning}</dd></div>)}
        </dl>
        <p className="mt-6 text-xs leading-relaxed text-gray-500">CollectBoss is operational software, not legal advice. Ask a qualified professional when a term affects a legal decision.</p>
      </main>
    </div>
  );
}
