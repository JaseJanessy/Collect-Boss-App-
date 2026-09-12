"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Archive, CalendarClock, ChevronRight, CircleDollarSign, Plus, ReceiptText, UserRound } from "lucide-react";
import { formatCurrencyMinor } from "@/lib/financial/money";
import { pocketStatusLabel, type PocketDebtState } from "@/lib/pocket/ledger";
import { createJsonService } from "@/lib/pocket/client-service";
import { PocketEmptyState, PocketUnavailable } from "./pocket-states";
import { PocketLoadingState, PocketStatusChip, pocketFieldClass, pocketPrimaryActionClass, pocketSecondaryActionClass } from "./pocket-ui";

type Customer = { id:string; displayName:string; businessName:string|null; phone:string|null; email:string|null; address:string|null; note:string|null; preferredReminderLanguage:string|null; archivedAt:string|null; debtCount:number; openBalanceMinor:number };
type Debt = { id:string;customerId:string;customerName:string;reference:string;description:string;originalAmountMinor:number;paidMinor:number;remainingMinor:number;currency:string;debtDate:string|null;dueDate:string|null;reminderPreference:string|null;status:PocketDebtState;daysOverdue:number;lastPaymentAt:string|null;archivedAt:string|null;createdAt:string;updatedAt:string };

const field = pocketFieldClass;
const primary = pocketPrimaryActionClass;
const secondary = pocketSecondaryActionClass;

const api = createJsonService({ fallbackMessage: "Something went wrong." });

function useCustomers() {
  const [state, setState] = useState<{ customers:Customer[];currency:string } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { void api<{customers:Customer[];currency:string}>("/api/pocket/customers").then(setState).catch(() => setError(true)); }, []);
  return { state, error };
}

export function PocketCustomers() {
  const { state, error } = useCustomers();
  if (error) return <PocketUnavailable />;
  if (!state) return <p role="status" className="py-12 text-center text-sm font-semibold text-slate-500">Loading customers…</p>;
  return <div className="mt-7">{state.customers.length ? <div className="grid gap-3 sm:grid-cols-2">{state.customers.map((customer) => (
    <Link key={customer.id} href={`/pocket/customers/${customer.id}`} className="flex min-h-28 items-center gap-4 rounded-3xl border border-emerald-950/10 bg-white p-5 shadow-sm outline-none hover:shadow-md focus-visible:ring-2 focus-visible:ring-[#087F5B]">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-[#087F5B]"><UserRound className="size-6" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1"><span className="block font-black text-[#092F2A]">{customer.displayName}</span><span className="mt-1 block text-sm text-slate-500">{customer.debtCount} debt{customer.debtCount === 1 ? "" : "s"} · {formatCurrencyMinor(customer.openBalanceMinor, state.currency)} open</span></span>
      <ChevronRight className="size-5 text-slate-400" aria-hidden="true" />
    </Link>
  ))}</div> : <PocketEmptyState title="No customers yet" message="Add the first person or business you want to track." action={<Link className={primary} href="/pocket/customers/new"><Plus className="mr-2 size-4" />Add Customer</Link>} />}</div>;
}

export function PocketCustomerForm() {
  const router = useRouter();
  const [busy,setBusy]=useState(false); const [error,setError]=useState(""); const [candidates,setCandidates]=useState<Array<{id:string;displayName:string;phone:string|null;email:string|null;reasons:string[]}>>([]);
  async function submit(event:FormEvent<HTMLFormElement>, confirmSeparate=false) {
    event.preventDefault(); setBusy(true); setError("");
    const values=Object.fromEntries(new FormData(event.currentTarget));
    try { const result=await api<{customerId:string}>("/api/pocket/customers",{method:"POST",body:JSON.stringify({ ...values, confirmSeparate })}); router.push(`/pocket/customers/${result.customerId}`); router.refresh(); }
    catch (cause) { const typed=cause as Error & {body?:{candidates?:typeof candidates}}; if (typed.body?.candidates) setCandidates(typed.body.candidates); setError(typed.message); } finally { setBusy(false); }
  }
  return <form onSubmit={(event)=>void submit(event)} aria-busy={busy} aria-describedby={error?"customer-form-error":undefined} className="pocket-card mt-7 space-y-5 p-5 sm:p-7">
    <label className="block text-sm font-bold text-[#092F2A]">Display name <span aria-hidden="true">*</span><input className={field} name="displayName" required maxLength={160} autoComplete="name" /></label>
    <label className="block text-sm font-bold text-[#092F2A]">Business name <span className="font-normal text-slate-500">(optional)</span><input className={field} name="businessName" maxLength={160} autoComplete="organization" /></label>
    <div className="grid gap-5 sm:grid-cols-2"><label className="block text-sm font-bold text-[#092F2A]">Phone <input className={field} name="phone" maxLength={50} inputMode="tel" autoComplete="tel" /></label><label className="block text-sm font-bold text-[#092F2A]">Email <input className={field} name="email" type="email" maxLength={254} autoComplete="email" /></label></div>
    <label className="block text-sm font-bold text-[#092F2A]">Address <textarea className={`${field} min-h-24 py-3`} name="address" maxLength={1000} autoComplete="street-address" /></label>
    <div className="grid gap-5 sm:grid-cols-2"><label className="block text-sm font-bold text-[#092F2A]">Reminder language <input className={field} name="preferredReminderLanguage" maxLength={40} placeholder="English" /></label><label className="block text-sm font-bold text-[#092F2A]">Note <textarea className={`${field} min-h-24 py-3`} name="note" maxLength={4000} /></label></div>
    {error ? <div id="customer-form-error" role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-bold">{error}</p>{candidates.map((candidate)=><p className="mt-2" key={candidate.id}>{candidate.displayName}{candidate.phone ? ` · ${candidate.phone}` : ""}{candidate.email ? ` · ${candidate.email}` : ""}</p>)}</div> : null}
    <div className="flex flex-wrap gap-3"><button disabled={busy} className={primary}>{busy ? "Saving…" : "Save Customer"}</button>{candidates.length ? <button type="button" disabled={busy} className={secondary} onClick={(event)=>{ const form=event.currentTarget.form; if(form) void submit({preventDefault:()=>undefined,currentTarget:form} as FormEvent<HTMLFormElement>,true); }}>Keep as separate customer</button>:null}<Link href="/pocket/customers" className={secondary}>Cancel</Link></div>
  </form>;
}

export function PocketCustomerEdit({customerId}:{customerId:string}) {
  const router=useRouter();const[data,setData]=useState<{customer:Customer}|null>(null);const[busy,setBusy]=useState(false);const[error,setError]=useState("");
  useEffect(()=>{void api<{customer:Customer}>(`/api/pocket/customers/${customerId}`).then(setData).catch((cause)=>setError(cause instanceof Error?cause.message:"Customer unavailable."));},[customerId]);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError("");try{await api(`/api/pocket/customers/${customerId}`,{method:"PATCH",body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});router.push(`/pocket/customers/${customerId}`);router.refresh();}catch(cause){setError(cause instanceof Error?cause.message:"The customer could not be updated.");}finally{setBusy(false);}}
  async function archive(){setBusy(true);setError("");try{await api(`/api/pocket/customers/${customerId}`,{method:"PATCH",body:JSON.stringify({archived:true})});router.push("/pocket/customers");router.refresh();}catch(cause){setError(cause instanceof Error?cause.message:"The customer could not be archived.");}finally{setBusy(false);}}
  if(!data)return error?<PocketUnavailable/>:<p role="status" className="py-12 text-center text-sm font-semibold text-slate-500">Loading customer…</p>;
  const c=data.customer;return <form onSubmit={(event)=>void submit(event)} aria-busy={busy} aria-describedby={error?"customer-edit-error":undefined} className="pocket-card mt-7 space-y-5 p-5 sm:p-7"><label className="block text-sm font-bold text-[#092F2A]">Display name<input className={field} name="displayName" required defaultValue={c.displayName}/></label><label className="block text-sm font-bold text-[#092F2A]">Business name<input className={field} name="businessName" defaultValue={c.businessName??""}/></label><div className="grid gap-5 sm:grid-cols-2"><label className="block text-sm font-bold text-[#092F2A]">Phone<input className={field} name="phone" defaultValue={c.phone??""}/></label><label className="block text-sm font-bold text-[#092F2A]">Email<input className={field} name="email" type="email" defaultValue={c.email??""}/></label></div><label className="block text-sm font-bold text-[#092F2A]">Address<textarea className={`${field} min-h-24 py-3`} name="address" defaultValue={c.address??""}/></label><label className="block text-sm font-bold text-[#092F2A]">Note<textarea className={`${field} min-h-24 py-3`} name="note" defaultValue={c.note??""}/></label><label className="block text-sm font-bold text-[#092F2A]">Reminder language<input className={field} name="preferredReminderLanguage" defaultValue={c.preferredReminderLanguage??""}/></label>{error?<p id="customer-edit-error" role="alert" className="rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-800">{error}</p>:null}<div className="flex flex-wrap gap-3"><button className={primary} disabled={busy}>{busy?"Saving…":"Save Changes"}</button><Link className={secondary} href={`/pocket/customers/${customerId}`}>Cancel</Link><button className={secondary} disabled={busy} type="button" onClick={()=>void archive()}><Archive className="mr-2 size-4"/>Archive Customer</button></div><p className="text-sm leading-6 text-slate-500">Archiving preserves the profile and history. Open or draft debts must be settled, cancelled, or archived first.</p></form>
}

export function PocketDebtForm({initialCustomerId}:{initialCustomerId?:string}={}) {
  const router=useRouter(); const {state,error:loadError}=useCustomers(); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  async function submit(event:FormEvent<HTMLFormElement>, draft:boolean) { event.preventDefault(); setBusy(true); setError(""); const formData=new FormData(event.currentTarget); const attachment=formData.get("attachment"); const values=Object.fromEntries(formData); delete values.attachment;
    try { const result=await api<{debtId:string}>("/api/pocket/debts",{method:"POST",body:JSON.stringify({...values,debtDate:values.debtDate||null,dueDate:values.dueDate||null,reference:values.reference||null,reminderPreference:values.reminderPreference||null,saveAsDraft:draft})});
      if(attachment instanceof File&&attachment.size>0){const upload=new FormData();upload.set("file",attachment);await api(`/api/pocket/debts/${result.debtId}/attachments`,{method:"POST",body:upload});}
      router.push(`/pocket/debts/${result.debtId}`); router.refresh(); }
    catch(cause){setError(cause instanceof Error?cause.message:"The debt could not be saved.");}finally{setBusy(false);} }
  if(loadError)return <PocketUnavailable/>; if(!state)return <p role="status" className="py-12 text-center text-sm font-semibold text-slate-500">Loading customers…</p>;
  if(!state.customers.length)return <div className="mt-7"><PocketEmptyState title="Add a customer first" message="Every Pocket debt belongs to one customer profile." action={<Link className={primary} href="/pocket/customers/new">Add Customer</Link>}/></div>;
  return <form onSubmit={(event)=>void submit(event,false)} aria-busy={busy} aria-describedby={error?"debt-form-error":undefined} className="pocket-card mt-7 space-y-5 p-5 sm:p-7">
    <label className="block text-sm font-bold text-[#092F2A]">Customer <span aria-hidden="true">*</span><select className={field} name="customerId" required defaultValue={initialCustomerId??""}><option value="" disabled>Choose a customer</option>{state.customers.map((customer)=><option value={customer.id} key={customer.id}>{customer.displayName}</option>)}</select></label>
    <div className="grid gap-5 sm:grid-cols-2"><label className="block text-sm font-bold text-[#092F2A]">Amount ({state.currency}) <span aria-hidden="true">*</span><input className={field} name="amount" required inputMode="decimal" placeholder="0.00" /></label><label className="block text-sm font-bold text-[#092F2A]">Reference <span className="font-normal text-slate-500">(optional)</span><input className={field} name="reference" maxLength={100} /></label></div>
    <label className="block text-sm font-bold text-[#092F2A]">What is this debt for? <span aria-hidden="true">*</span><textarea className={`${field} min-h-24 py-3`} name="description" required maxLength={500} placeholder="For example: supplies delivered" /></label>
    <div className="grid gap-5 sm:grid-cols-2"><label className="block text-sm font-bold text-[#092F2A]">Debt date <input className={field} name="debtDate" type="date" /></label><label className="block text-sm font-bold text-[#092F2A]">Due date <input className={field} name="dueDate" type="date" /></label></div>
    <label className="block text-sm font-bold text-[#092F2A]">Reminder preference <select className={field} name="reminderPreference" defaultValue=""><option value="">No reminder yet</option><option value="later">Remind me later</option><option value="on_due_date">On the due date</option><option value="weekly">Weekly</option></select></label>
    <label className="block text-sm font-bold text-[#092F2A]">Attachment <span className="font-normal text-slate-500">(optional)</span><input className={`${field} py-3`} name="attachment" type="file" accept="application/pdf,image/jpeg,image/png,image/heic"/><span className="mt-2 block font-normal leading-5 text-slate-500">Stored through the existing secure evidence and malware-scanning workflow.</span></label>
    <p className="text-sm leading-6 text-slate-500">Pocket does not create an invoice or a collection case.</p>
    {error?<p id="debt-form-error" role="alert" className="rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-800">{error}</p>:null}
    <div className="flex flex-wrap gap-3"><button disabled={busy} className={primary}>{busy?"Saving…":"Save Debt"}</button><button type="button" disabled={busy} className={secondary} onClick={(event)=>{const form=event.currentTarget.form;if(form)void submit({preventDefault:()=>undefined,currentTarget:form} as FormEvent<HTMLFormElement>,true);}}>Save Draft</button><Link className={secondary} href="/pocket/debts">Cancel</Link></div>
  </form>;
}

export function PocketDebtList({filter}:{filter?:"due-today"|"overdue"}) {
  const [data,setData]=useState<{debts:Debt[];currency:string;today:string}|null>(null); const [error,setError]=useState(false);
  useEffect(()=>{void api<{debts:Debt[];currency:string;today:string}>(`/api/pocket/debts${filter?`?filter=${filter}`:""}`).then(setData).catch(()=>setError(true));},[filter]);
  if(error)return <PocketUnavailable/>;if(!data)return <p role="status" className="py-12 text-center text-sm font-semibold text-slate-500">Loading debts…</p>;
  return <div className="mt-7">{data.debts.length?<div className="space-y-3">{data.debts.map((debt)=><DebtCard debt={debt} key={debt.id}/>)}</div>:<PocketEmptyState title={filter==="due-today"?"Nothing due today":filter==="overdue"?"No overdue debts":"No debts yet"} message={filter?"You are all caught up for this view.":"Add a simple debt to start tracking what a customer owes."} action={!filter?<Link className={primary} href="/pocket/debts/new">Add Debt</Link>:undefined}/>}</div>;
}

function DebtCard({debt}:{debt:Debt}) { const tone=debt.status==="settled"?"success":debt.status==="overdue"?"danger":debt.status==="partially_paid"?"warning":"neutral";return <Link href={`/pocket/debts/${debt.id}`} className="pocket-card flex min-h-28 items-center gap-4 p-4 outline-none hover:border-emerald-700/40 hover:shadow-md sm:p-5">
  <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-[#087F5B]"><CircleDollarSign className="size-6" aria-hidden="true"/></span><span className="min-w-0 flex-1"><span className="block font-black text-[#092F2A]">{debt.customerName}</span><span className="mt-1 block text-sm text-slate-500">{debt.description}</span><PocketStatusChip className="mt-2" label={pocketStatusLabel(debt.status)} tone={tone}/></span><span className="shrink-0 text-right"><span className="block font-black text-[#092F2A]">{formatCurrencyMinor(debt.remainingMinor,debt.currency)}</span>{debt.daysOverdue?<span className="mt-1 block text-xs font-bold text-red-700">{debt.daysOverdue}d overdue</span>:null}</span></Link>; }

export function PocketCustomerProfile({customerId}:{customerId:string}) {
  const [data,setData]=useState<{customer:Customer;debts:Debt[];recentPayments:Array<{id:string;debtId:string;eventType:"allocation"|"reversal";amountMinor:number;currency:string;createdAt:string}>;reminders:Array<{debtId:string;description:string;preference:string}>;lastReminderAt:string|null;lastReminderEvent:string|null}|null>(null); const [error,setError]=useState(false);
  useEffect(()=>{void api<typeof data>(`/api/pocket/customers/${customerId}`).then(setData).catch(()=>setError(true));},[customerId]);
  const currency=data?.debts[0]?.currency??"MYR"; if(error)return <PocketUnavailable/>;if(!data)return <p role="status" className="py-12 text-center text-sm font-semibold text-slate-500">Loading profile…</p>;
  const settled=data.debts.filter((debt)=>debt.status==="settled"); const reminderDebt=data.debts.find((debt)=>["active","partially_paid","overdue"].includes(debt.status)&&!debt.archivedAt); return <div className="space-y-7"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-bold text-[#087F5B]">Customer Profile</p><h1 className="mt-2 text-3xl font-black text-[#092F2A]">{data.customer.displayName}</h1><p className="mt-2 text-sm text-slate-500">{[data.customer.phone,data.customer.email].filter(Boolean).join(" · ")||"No contact details yet"}</p><p className="mt-1 text-xs font-semibold text-slate-500">Last reminder: {data.lastReminderAt?new Date(data.lastReminderAt).toLocaleString():"None yet"}</p></div><div className="flex flex-wrap gap-3">{reminderDebt?<Link className={primary} href={`/pocket/reminders/compose?debtId=${reminderDebt.id}&language=${data.customer.preferredReminderLanguage||"en"}`}>Send Reminder</Link>:null}<Link className={secondary} href={`/pocket/customers/${customerId}/edit`}>Edit</Link><Link className={secondary} href={`/pocket/payments/new?customerId=${customerId}`}>Record Payment</Link><Link className={secondary} href={`/pocket/debts/new?customerId=${customerId}`}><Plus className="mr-2 size-4"/>Add Debt</Link></div></div>
    <div className="grid gap-4 sm:grid-cols-3"><Metric label="Open balance" value={formatCurrencyMinor(data.customer.openBalanceMinor,currency)}/><Metric label="All debts" value={String(data.debts.length)}/><Metric label="Settled" value={String(settled.length)}/></div>
    <section><h2 className="text-xl font-black text-[#092F2A]">Debts</h2><div className="mt-3 space-y-3">{data.debts.length?data.debts.map((debt)=><DebtCard key={debt.id} debt={debt}/>):<PocketEmptyState title="No debts for this customer" message="Their active, overdue, and settled debts will appear here."/>}</div></section>
    <section className="grid gap-4 sm:grid-cols-2"><div className="rounded-3xl bg-white p-5"><h2 className="font-black text-[#092F2A]">Recent payments & receipts</h2>{data.recentPayments.length?data.recentPayments.slice(0,5).map((payment)=><Link className="mt-3 flex items-center justify-between text-sm" href={payment.eventType==="allocation"?`/pocket/payments/${payment.id}`:"/pocket/activity"} key={payment.id}><span className="font-semibold text-slate-600">{payment.eventType==="reversal"?"Reversal":"Payment"}</span><span className="font-black text-[#092F2A]">{payment.eventType==="reversal"?"−":""}{formatCurrencyMinor(payment.amountMinor,payment.currency)}</span></Link>):<p className="mt-2 text-sm leading-6 text-slate-500">No approved payment allocations yet.</p>}</div><div className="rounded-3xl bg-white p-5"><h2 className="font-black text-[#092F2A]">Reminders</h2>{data.reminders.length?data.reminders.map((item)=><p className="mt-2 text-sm text-slate-600" key={item.debtId}>{item.description} · {item.preference.replaceAll("_"," ")}</p>):<p className="mt-2 text-sm text-slate-500">No reminder preferences saved.</p>}</div></section>
  </div>;
}

function Metric({label,value}:{label:string;value:string}){return <div className="rounded-3xl border border-emerald-950/10 bg-white p-5"><p className="text-sm font-semibold text-slate-500">{label}</p><p className="mt-2 text-2xl font-black text-[#092F2A]">{value}</p></div>}

export function PocketDebtProfile({debtId}:{debtId:string}){const router=useRouter();const[data,setData]=useState<{debt:Debt;attachments:Array<{id:string;file_name:string;scan_status:string}>}|null>(null);const[error,setError]=useState("");useEffect(()=>{void api<{debt:Debt;attachments:Array<{id:string;file_name:string;scan_status:string}>}>(`/api/pocket/debts/${debtId}`).then(setData).catch((cause)=>setError(cause instanceof Error?cause.message:"Debt unavailable."));},[debtId]);async function action(name:"activate"|"cancel"|"archive"|"restore"){setError("");try{await api(`/api/pocket/debts/${debtId}`,{method:"PATCH",body:JSON.stringify({action:name})});router.refresh();const fresh=await api<{debt:Debt;attachments:Array<{id:string;file_name:string;scan_status:string}>}>(`/api/pocket/debts/${debtId}`);setData(fresh);}catch(cause){setError(cause instanceof Error?cause.message:"Action failed.");}}if(!data)return error?<PocketUnavailable/>:<p role="status" className="py-12 text-center text-sm font-semibold text-slate-500">Loading debt…</p>;const d=data.debt;return <div><p className="text-sm font-bold text-[#087F5B]">Simple Debt</p><h1 className="mt-2 text-3xl font-black text-[#092F2A]">{d.description}</h1><p className="mt-2 text-slate-500">{d.customerName} · {d.reference}</p><div className="mt-7 grid gap-4 sm:grid-cols-3"><Metric label="Original" value={formatCurrencyMinor(d.originalAmountMinor,d.currency)}/><Metric label="Paid" value={formatCurrencyMinor(d.paidMinor,d.currency)}/><Metric label="Remaining" value={formatCurrencyMinor(d.remainingMinor,d.currency)}/></div><div className="mt-5 rounded-3xl bg-white p-5 text-sm leading-7 text-slate-600"><p><strong>Status:</strong> {pocketStatusLabel(d.status)}</p><p><strong>Debt date:</strong> {d.debtDate||"Not set"}</p><p><strong>Due date:</strong> {d.dueDate||"Not set"}</p><p><strong>Days overdue:</strong> {d.daysOverdue}</p><p><strong>Last payment:</strong> {d.lastPaymentAt||"No approved payment yet"}</p><p><strong>Attachments:</strong> {data.attachments.length?data.attachments.map((item)=>`${item.file_name} (${item.scan_status})`).join(", "):"None"}</p></div>{error?<p role="alert" className="mt-4 rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-800">{error}</p>:null}<div className="mt-5 flex flex-wrap gap-3">{["active","partially_paid","overdue"].includes(d.status)?<Link className={primary} href={`/pocket/payments/new?customerId=${d.customerId}&debtId=${d.id}`}>Record Payment</Link>:null}{d.status==="draft"?<button className={primary} onClick={()=>void action("activate")}>Activate Debt</button>:null}{!d.archivedAt&&!['settled','cancelled'].includes(d.status)?<button className={secondary} onClick={()=>void action("cancel")}>Cancel Debt</button>:null}<button className={secondary} onClick={()=>void action(d.archivedAt?"restore":"archive")}><Archive className="mr-2 size-4"/>{d.archivedAt?"Restore":"Archive"}</button><Link className={secondary} href="/pocket/debts">Back</Link></div></div>}

type HomePayment = { allocationId:string; customerName:string; amountMinor:number; currency:string; paymentDate:string; status:"confirmed"|"reversed" };

async function loadPocketHomeState() {
  const [dueResult,overdueResult,paymentResult]=await Promise.all([
    api<{debts:Debt[]}>("/api/pocket/debts?filter=due-today"),
    api<{debts:Debt[]}>("/api/pocket/debts?filter=overdue"),
    api<{payments:HomePayment[]}>("/api/pocket/payments"),
  ]);
  return {due:dueResult.debts,overdue:overdueResult.debts,payments:paymentResult.payments};
}

export function PocketHomeLedger({ children }: { children: ReactNode }) {
  const [state,setState]=useState<{due:Debt[];overdue:Debt[];payments:HomePayment[]}|null>(null);
  const [error,setError]=useState(false);
  useEffect(()=>{let active=true;void loadPocketHomeState().then((value)=>{if(active)setState(value);}).catch(()=>{if(active)setError(true);});return()=>{active=false;};},[]);

  if(!state && !error) return <><PocketLoadingState label="Loading today's collection summary"/>{children}</>;
  if(!state) return <><div role="alert" className="pocket-card flex flex-wrap items-center justify-between gap-4 p-4"><span className="flex items-center gap-3 text-sm font-bold text-red-900"><AlertCircle aria-hidden="true" className="size-5 shrink-0"/>Today&apos;s totals could not load.</span><button className={pocketSecondaryActionClass} onClick={()=>{setError(false);void loadPocketHomeState().then(setState).catch(()=>setError(true));}}>Retry</button></div>{children}</>;

  const dueTotal=state.due.reduce((sum,debt)=>sum+debt.remainingMinor,0);
  const overdueTotal=state.overdue.reduce((sum,debt)=>sum+debt.remainingMinor,0);
  const currency=state.due[0]?.currency??state.overdue[0]?.currency??state.payments[0]?.currency??"MYR";
  const recent=state.payments.slice(0,3);

  return <div className="space-y-6">
    <section aria-label="Today collection summary" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <div className="pocket-summary-card pocket-today-card col-span-2 lg:col-span-1">
        <div className="flex items-center justify-between gap-4"><p className="text-sm font-bold text-emerald-100">Today to Collect</p><CalendarClock aria-hidden="true" className="size-5 text-[#8EF0D0]"/></div>
        <p className="mt-2 text-[clamp(1.8rem,7vw,2.75rem)] font-black leading-none tracking-tight">{formatCurrencyMinor(dueTotal,currency)}</p>
        <p className="mt-2 text-xs font-semibold text-emerald-100">{state.due.length} {state.due.length===1?"debt":"debts"} due today</p>
      </div>
      <Link href="/pocket/due-today" className="pocket-summary-card pocket-tactile block">
        <p className="text-xs font-black uppercase tracking-wide text-[#647773]">Due Today</p><p className="mt-2 text-2xl font-black text-[#082C32]">{state.due.length}</p><span className="mt-3 inline-flex text-sm font-black text-[#087F5B]">View <span aria-hidden="true">→</span></span>
      </Link>
      <Link href="/pocket/overdue" className="pocket-summary-card pocket-tactile block">
        <p className="text-xs font-black uppercase tracking-wide text-[#8C3A32]">Overdue</p><p className="mt-2 text-xl font-black text-[#9B2C24]">{formatCurrencyMinor(overdueTotal,currency)}</p><span className="mt-3 inline-flex text-sm font-black text-[#9B2C24]">{state.overdue.length} to review <span aria-hidden="true">→</span></span>
      </Link>
    </section>

    {children}

    <section aria-labelledby="recent-payments-title" className="pocket-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-4"><h2 id="recent-payments-title" className="flex items-center gap-2 text-lg font-black text-[#082C32]"><ReceiptText aria-hidden="true" className="size-5 text-[#087F5B]"/>Recent payments</h2><Link href="/pocket/activity" className="text-sm font-black text-[#087F5B]">View all</Link></div>
      {recent.length?<div className="mt-3 divide-y divide-[#e6eee9]">{recent.map((payment)=><Link key={payment.allocationId} href={`/pocket/payments/${payment.allocationId}`} className="flex min-h-14 items-center justify-between gap-3 py-3"><span className="min-w-0"><span className="block font-bold text-[#082C32]">{payment.customerName}</span><span className="block text-xs font-semibold text-[#647773]">{payment.paymentDate} · {payment.status==="reversed"?"Reversed":"Confirmed"}</span></span><strong className="shrink-0 text-[#082C32]">{formatCurrencyMinor(payment.amountMinor,payment.currency)}</strong></Link>)}</div>:<p className="mt-3 text-sm leading-6 text-[#536866]">No confirmed payments yet. They will appear here after you record one.</p>}
      <div className="mt-4 flex flex-wrap gap-2"><Link href="/pocket/payments/new" className={pocketPrimaryActionClass}>Record Payment</Link><Link href="/pocket/reminders?group=today" className={pocketSecondaryActionClass}>Remind All</Link></div>
    </section>
  </div>;
}
