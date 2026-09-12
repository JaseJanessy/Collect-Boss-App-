import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowUpRight, CalendarClock, HandCoins, ReceiptText, ScanLine, Users } from "lucide-react";

import { PocketNavigationIcon } from "@/components/pocket/pocket-navigation-icon";
import { PocketEmptyState } from "@/components/pocket/pocket-states";
import { CollectBossPocketWordmark } from "@/components/brand/pocket-wordmark";
import { PocketLoadingState, PocketPageHeader, PocketStatusChip, pocketFieldClass, pocketPrimaryActionClass, pocketSecondaryActionClass } from "@/components/pocket/pocket-ui";
import { pocketCssVariables } from "@/lib/brand/pocket-theme";
import { pocketPrimaryNavigation } from "@collectboss/pocket-navigation";

export const metadata: Metadata = { title:"Pocket UX preview", robots:{index:false,follow:false} };

const actions=[
  {label:"Add Debt",icon:HandCoins},
  {label:"Record Payment",icon:CalendarClock},
  {label:"Scan Receipt",icon:ScanLine},
  {label:"Who Owes Me",icon:Users},
];

function PreviewState({state}:{state?:string}) {
  if(state==="loading") return <PocketLoadingState label="Loading Pocket preview"/>;
  if(state==="empty") return <PocketEmptyState title="Nothing due today" message="You are all caught up. New due items will appear here."/>;
  const copy:Record<string,string>={permission:"You do not have permission to change this item.",quota:"You have used all 60 invoices for this cycle.","past-due":"Your plan is past due. History stays available in read-only mode.",offline:"You are offline. Unsaved changes may not be sent.",error:"Pocket could not load the latest totals."};
  if(state&&copy[state]) return <div role="alert" className="pocket-card flex flex-wrap items-center justify-between gap-4 border-amber-300 p-5"><span className="flex items-center gap-3 font-bold text-amber-950"><AlertTriangle aria-hidden="true" className="size-5"/>{copy[state]}</span>{state==="error"?<button className={pocketSecondaryActionClass}>Retry</button>:null}</div>;
  return null;
}

export default async function PocketUxPreviewPage({searchParams}:{searchParams:Promise<{state?:string}>}) {
  if(process.env.NODE_ENV!=="development") notFound();
  const {state}=await searchParams;
  return <div className="pocket-root min-h-[100dvh] lg:flex" data-pocket-theme style={pocketCssVariables}>
    <aside className="hidden w-64 shrink-0 bg-[var(--pocket-brand-navy)] p-5 text-white lg:block"><CollectBossPocketWordmark variant="dark"/><nav aria-label="Preview primary navigation" className="mt-8 space-y-2">{pocketPrimaryNavigation.map((item)=><span key={item.id} className={`flex min-h-13 items-center gap-3 rounded-2xl px-4 font-black ${item.id==="home"?"bg-[var(--pocket-brand-green)] text-[var(--pocket-brand-navy)]":"text-white"}`}><PocketNavigationIcon name={item.icon} className="size-5"/>{item.label}</span>)}</nav></aside>
    <div className="min-w-0 flex-1"><header className="pocket-topbar border-b border-[var(--pocket-line)] bg-white px-4 py-3 sm:px-6"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3"><CollectBossPocketWordmark compact/><strong className="min-w-0 truncate text-sm text-[var(--pocket-muted)]">Kedai Maju Jaya Enterprise With A Very Long Business Name</strong></div></header>
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-5 pb-28 sm:px-6 lg:pb-8">
      <PocketPageHeader id="preview-title" eyebrow="CollectBoss Pocket" title="Today" description="See what needs attention, then take one clear action."/>
      <PreviewState state={state}/>
      {!state?<>
        <section aria-label="Today collection summary" className="grid grid-cols-2 gap-3 lg:grid-cols-3"><div className="pocket-summary-card pocket-today-card col-span-2 lg:col-span-1"><p className="text-sm font-bold text-emerald-100">Today to Collect</p><p className="mt-2 text-3xl font-black">RM 12,345,678.90</p><p className="mt-2 text-xs text-emerald-100">8 debts due today</p></div><div className="pocket-summary-card"><p className="text-xs font-black uppercase text-[#647773]">Due Today</p><p className="mt-2 text-2xl font-black">8</p><PocketStatusChip className="mt-2" label="Needs review" tone="warning"/></div><div className="pocket-summary-card"><p className="text-xs font-black uppercase text-[#8C3A32]">Overdue</p><p className="mt-2 text-xl font-black text-[#9B2C24]">RM 9,876.50</p><PocketStatusChip className="mt-2" label="3 overdue" tone="danger"/></div></section>
        <section aria-labelledby="preview-actions"><h2 id="preview-actions" className="text-xl font-black">Quick actions</h2><div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">{actions.map(({label,icon:Icon})=>{const actionId=label.toLowerCase().replaceAll(" ","-");return <button key={label} data-pocket-action={actionId} className="pocket-action-tile text-left"><span className="flex items-start justify-between"><span className="pocket-action-icon flex size-12 items-center justify-center rounded-2xl"><Icon aria-hidden="true" className="size-6"/></span><ArrowUpRight aria-hidden="true" className="size-5 text-[var(--pocket-muted)]"/></span><strong>{label}</strong></button>;})}</div></section>
        <section className="pocket-card p-5"><h2 className="flex items-center gap-2 text-lg font-black"><ReceiptText aria-hidden="true" className="size-5 text-[#087F5B]"/>Recent payment</h2><div className="mt-4 flex items-start justify-between gap-4"><span className="min-w-0"><strong className="block">A Customer Name That Is Intentionally Very Long To Test Accessible Text Scaling</strong><span className="text-xs text-[#536866]">22 Aug 2026 · Confirmed</span></span><strong className="shrink-0">RM 888,888.88</strong></div><div className="mt-5 flex flex-wrap gap-2"><button className={pocketPrimaryActionClass}>Record Payment</button><button className={pocketSecondaryActionClass}>Remind</button></div></section>
        <section className="pocket-card p-5"><h2 className="text-lg font-black">Field and error association</h2><label htmlFor="preview-amount" className="mt-4 block text-sm font-bold">Amount</label><input id="preview-amount" className={pocketFieldClass} inputMode="decimal" defaultValue="1234.00"/><p id="preview-help" className="mt-2 text-sm text-[#536866]">Review the exact amount before confirming.</p></section>
      </>:null}
    </main></div>
    <nav aria-label="Preview primary navigation" className="pocket-bottom-nav fixed inset-x-0 bottom-0 grid min-h-20 grid-cols-5 border-t border-[var(--pocket-line)] bg-white px-1 lg:hidden">{pocketPrimaryNavigation.map((item)=><Link href="#preview-title" key={item.id} className="flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-black text-[var(--pocket-muted)]"><PocketNavigationIcon name={item.icon} className="size-5"/><span>{item.label}</span></Link>)}</nav>
  </div>;
}
