"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { FileText, Plus, Trash2 } from "lucide-react";

import type { PocketEntitlementView } from "@/lib/billing/pocket-entitlements";
import { requestBlob } from "@/lib/data/http-service";
import { formatCurrencyMinor, minorToDecimalString } from "@/lib/financial/money";
import { createJsonService } from "@/lib/pocket/client-service";
import { formatInvoiceQuantity, invoiceWhatsAppMessage, POCKET_INVOICE_DISCLAIMER } from "@/lib/pocket/invoices";
import type { PocketInvoiceView } from "@/lib/pocket/invoices-server";
import { PocketEmptyState, PocketUnavailable } from "./pocket-states";
import { PocketStatusChip, pocketFieldClass, pocketPrimaryActionClass, pocketSecondaryActionClass } from "./pocket-ui";

const primary = pocketPrimaryActionClass;
const secondary = pocketSecondaryActionClass;
const field = pocketFieldClass;

type Customer = { id: string; displayName: string; businessName: string | null; phone: string | null; email: string | null; address: string | null };
type Line = { description: string; quantity: string; unitPrice: string };

const api = createJsonService({ fallbackMessage: "The invoice action failed.", cache: "no-store" });

function useEntitlements() {
  const [value, setValue] = useState<PocketEntitlementView | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { void api<PocketEntitlementView>("/api/pocket/entitlements").then(setValue).catch(() => setError(true)); }, []);
  return { value, error };
}

export function PocketInvoiceEntry() {
  const { value, error } = useEntitlements();
  if (error) return null;
  const capability = value?.capabilities["pocket.invoice.create"];
  if (!value) return <div className="min-h-36 animate-pulse rounded-3xl bg-emerald-50" aria-label="Loading invoice access" />;
  if (!capability?.enabled) return <Link href="/pocket/billing" className="pocket-action-tile border-dashed border-amber-300 bg-amber-50"><span className="flex size-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-800"><FileText aria-hidden="true" className="size-6"/></span><span><span className="block font-black text-amber-950">Invoice locked</span><span className="mt-1 block text-xs leading-5 text-amber-900">RM10/month add-on</span></span></Link>;
  return <Link href="/pocket/invoices/new" className="pocket-action-tile"><span className="flex size-12 items-center justify-center rounded-2xl bg-[#DFF7EF] text-[#087F5B]"><FileText aria-hidden="true" className="size-6"/></span><span><span className="block font-black text-[#092F2A]">Create Invoice</span><span className="mt-1 block text-xs leading-5 text-slate-500">{capability.used ?? 0} / {capability.limit ?? 30} issued</span></span></Link>;
}

export function PocketInvoiceList() {
  const [invoices, setInvoices] = useState<PocketInvoiceView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const { value } = useEntitlements();
  useEffect(() => { void api<{ invoices: PocketInvoiceView[] }>("/api/pocket/invoices").then((result) => setInvoices(result.invoices)).catch(() => setFailed(true)); }, []);
  if (failed) return <PocketUnavailable />;
  if (!invoices) return <p role="status" className="py-12 text-center text-sm font-semibold text-slate-500">Loading invoices...</p>;
  const capability = value?.capabilities["pocket.invoice.create"];
  return <div className="mt-7 space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-emerald-950/10 bg-white p-5"><div><p className="text-sm font-semibold text-slate-500">Current billing cycle</p><p className="mt-1 text-xl font-black text-[#092F2A]">{capability?.used ?? 0} of {capability?.limit ?? 0} issued this cycle</p></div>{capability?.enabled?<Link className={primary} href="/pocket/invoices/new"><Plus className="mr-2 size-4"/>Create Invoice</Link>:<Link className={secondary} href="/pocket/billing">Activate add-on</Link>}</div>
    {invoices.length?<div className="space-y-3">{invoices.map((invoice)=><Link key={invoice.id} href={`/pocket/invoices/${invoice.id}`} className="pocket-card flex min-h-24 items-center justify-between gap-4 p-5 outline-none hover:shadow-md"><span className="min-w-0"><span className="block font-black text-[#092F2A]">{invoice.invoiceNumber ?? "Draft invoice"}</span><span className="mt-1 block text-sm text-slate-500">{invoice.customerName} - due {invoice.dueDate}</span><PocketStatusChip className="mt-2 capitalize" label={invoice.status.replaceAll("_"," ")} tone={invoice.status==="paid"?"success":invoice.status==="cancelled"?"danger":invoice.status==="partially_paid"?"warning":"neutral"}/></span><span className="shrink-0 font-black text-[#092F2A]">{formatCurrencyMinor(invoice.totalMinor,invoice.currency)}</span></Link>)}</div>:<PocketEmptyState title="No invoices yet" message="Create a draft and preview it without using an invoice number or cycle quota." action={capability?.enabled?<Link className={primary} href="/pocket/invoices/new">Create Invoice</Link>:undefined}/>} 
    <Disclaimer />
  </div>;
}

export function PocketInvoiceForm({ invoiceId }: { invoiceId?: string }) {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [existing, setExisting] = useState<PocketInvoiceView | null>(null);
  const [lines, setLines] = useState<Line[]>([{ description: "", quantity: "1", unitPrice: "" }]);
  const [defaultDates] = useState(() => { const issue = new Date(); const due = new Date(issue); due.setUTCDate(due.getUTCDate() + 7); return { issue: issue.toISOString().slice(0,10), due: due.toISOString().slice(0,10) }; });
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const { value, error: entitlementError } = useEntitlements();
  useEffect(() => { void api<{ customers: Customer[] }>("/api/pocket/customers").then((result) => setCustomers(result.customers)).catch(() => setError("Customers are unavailable.")); }, []);
  useEffect(() => { if (!invoiceId) return; void api<{ invoice: PocketInvoiceView }>(`/api/pocket/invoices/${invoiceId}`).then((result) => { setExisting(result.invoice); setLines(result.invoice.items.map((item) => ({ description:item.description, quantity:formatInvoiceQuantity(item.quantityMilli), unitPrice:minorToDecimalString(BigInt(item.unitPriceMinor),result.invoice.currency) }))); }).catch((cause) => setError(cause instanceof Error?cause.message:"Invoice unavailable.")); }, [invoiceId]);
  const capability = value?.capabilities["pocket.invoice.create"];
  const ready = customers && (!invoiceId || existing);
  function updateLine(index: number, key: keyof Line, text: string) { setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, [key]: text } : line)); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    const customer = customers?.find((item) => item.id === data.get("customerId"));
    const payload = {
      customerId: String(data.get("customerId")), issueDate: String(data.get("issueDate")), dueDate: String(data.get("dueDate")),
      businessName: "Saved business profile", businessContact: String(data.get("businessContact") || "") || null,
      customerName: customer?.displayName ?? "Customer", customerContact: String(data.get("customerContact") || "") || null,
      discount: String(data.get("discount") || "0"), taxLabel: String(data.get("taxLabel") || "") || null,
      tax: String(data.get("tax") || "0"), note: String(data.get("note") || "") || null,
      paymentInstructions: String(data.get("paymentInstructions") || "") || null, items: lines,
      ...(existing ? { expectedVersion: existing.version } : {}),
    };
    try {
      const result = await api<{ invoiceId: string }>(existing?`/api/pocket/invoices/${existing.id}`:"/api/pocket/invoices", { method: existing?"PUT":"POST", headers:{"Idempotency-Key":crypto.randomUUID()}, body:JSON.stringify(payload) });
      router.push(`/pocket/invoices/${result.invoiceId}`); router.refresh();
    } catch (cause) { setError(cause instanceof Error?cause.message:"The invoice could not be saved."); } finally { setBusy(false); }
  }
  async function uploadLogo(file: File) {
    if (!existing) return;
    setBusy(true); setError("");
    try { const body=new FormData();body.set("file",file);await api(`/api/pocket/invoices/${existing.id}/logo`,{method:"POST",body},"Logo upload failed.");const fresh=await api<{invoice:PocketInvoiceView}>(`/api/pocket/invoices/${existing.id}`);setExisting(fresh.invoice); }
    catch(cause){setError(cause instanceof Error?cause.message:"Logo upload failed.");}finally{setBusy(false);}
  }
  if (entitlementError) return <PocketUnavailable />;
  if (value && !capability?.enabled) return <div className="mt-7 rounded-3xl border border-amber-200 bg-amber-50 p-6"><h2 className="text-xl font-black text-amber-950">Simple Invoice add-on required</h2><p className="mt-2 text-sm leading-6 text-amber-900">Activate the RM10/month add-on to create or edit invoices. Existing issued invoices remain readable.</p><Link className={`${primary} mt-5`} href="/pocket/billing">View Plan &amp; Limits</Link></div>;
  if (!ready) return <p role="status" className="py-12 text-center text-sm font-semibold text-slate-500">Loading invoice form...</p>;
  if (!customers.length) return <PocketEmptyState title="Add a customer first" message="Every invoice must use a Pocket customer profile." action={<Link className={primary} href="/pocket/customers/new">Add Customer</Link>}/>;
  if (existing && existing.status !== "draft") return <p className="mt-7 rounded-2xl bg-amber-50 p-4 text-sm text-amber-950">Issued invoices are immutable.</p>;
  return <form onSubmit={(event)=>void submit(event)} aria-busy={busy} aria-describedby={error?"invoice-form-error":undefined} className="pocket-card mt-7 space-y-5 p-5 sm:p-7">
    <label className="block text-sm font-bold text-[#092F2A]">Customer<select className={field} name="customerId" required defaultValue={existing?.customerId??""}><option value="" disabled>Choose a customer</option>{customers.map((customer)=><option key={customer.id} value={customer.id}>{customer.displayName}</option>)}</select></label>
    <div className="grid gap-5 sm:grid-cols-2"><label className="block text-sm font-bold text-[#092F2A]">Issue date<input className={field} name="issueDate" type="date" required defaultValue={existing?.issueDate??defaultDates.issue}/></label><label className="block text-sm font-bold text-[#092F2A]">Due date<input className={field} name="dueDate" type="date" required defaultValue={existing?.dueDate??defaultDates.due}/></label></div>
    <section><div className="flex items-center justify-between"><h2 className="font-black text-[#092F2A]">Line items</h2><button type="button" className={secondary} onClick={()=>setLines((current)=>[...current,{description:"",quantity:"1",unitPrice:""}])}><Plus className="mr-2 size-4"/>Add line</button></div><div className="mt-3 space-y-3">{lines.map((line,index)=><div key={index} className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-[1fr_7rem_10rem_auto]"><label className="text-xs font-bold text-slate-600">Description<input className={field} required value={line.description} onChange={(event)=>updateLine(index,"description",event.target.value)}/></label><label className="text-xs font-bold text-slate-600">Quantity<input className={field} required inputMode="decimal" value={line.quantity} onChange={(event)=>updateLine(index,"quantity",event.target.value)}/></label><label className="text-xs font-bold text-slate-600">Unit price<input className={field} required inputMode="decimal" value={line.unitPrice} onChange={(event)=>updateLine(index,"unitPrice",event.target.value)}/></label><button type="button" aria-label={`Remove line ${index+1}`} disabled={lines.length===1} className="mt-6 size-12 rounded-2xl text-red-700 disabled:opacity-30" onClick={()=>setLines((current)=>current.filter((_,lineIndex)=>lineIndex!==index))}><Trash2 className="mx-auto size-5"/></button></div>)}</div></section>
    <div className="grid gap-5 sm:grid-cols-3"><label className="block text-sm font-bold text-[#092F2A]">Discount<input className={field} name="discount" inputMode="decimal" defaultValue={existing?minorToDecimalString(BigInt(existing.discountMinor),existing.currency):"0.00"}/></label><label className="block text-sm font-bold text-[#092F2A]">Tax label (optional)<input className={field} name="taxLabel" defaultValue={existing?.taxLabel??""} placeholder="For example: SST"/></label><label className="block text-sm font-bold text-[#092F2A]">Fixed tax amount<input className={field} name="tax" inputMode="decimal" defaultValue={existing?minorToDecimalString(BigInt(existing.taxMinor),existing.currency):"0.00"}/></label></div>
    {existing?<label className="block text-sm font-bold text-[#092F2A]">Logo (optional)<input className={`${field} py-3`} type="file" accept="image/png,image/jpeg" onChange={(event)=>{const file=event.target.files?.[0];if(file)void uploadLogo(file)}}/><span className="mt-2 block font-normal text-slate-500">PNG or JPEG, up to 2 MB. Stored privately and included in the PDF. {existing.logoObjectPath?"A logo is saved.":""}</span></label>:<p className="text-sm text-slate-500">Save the draft once to add an optional private logo.</p>}
    <label className="block text-sm font-bold text-[#092F2A]">Business contact (optional)<textarea className={`${field} min-h-20 py-3`} name="businessContact" defaultValue={existing?.businessContact??""}/></label><label className="block text-sm font-bold text-[#092F2A]">Customer contact (optional)<textarea className={`${field} min-h-20 py-3`} name="customerContact" defaultValue={existing?.customerContact??""}/></label>
    <label className="block text-sm font-bold text-[#092F2A]">Payment instructions<textarea className={`${field} min-h-24 py-3`} name="paymentInstructions" defaultValue={existing?.paymentInstructions??""}/></label><label className="block text-sm font-bold text-[#092F2A]">Note<textarea className={`${field} min-h-24 py-3`} name="note" defaultValue={existing?.note??""}/></label>
    <p className="rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">Saving and previewing a draft do not use a number or quota. A number is committed only when you issue it.</p><Disclaimer/>
    {error?<p id="invoice-form-error" role="alert" className="rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-800">{error}</p>:null}<div className="flex flex-wrap gap-3"><button className={primary} disabled={busy}>{busy?"Saving...":"Save & Preview"}</button><Link className={secondary} href={existing?`/pocket/invoices/${existing.id}`:"/pocket/invoices"}>Cancel</Link></div>
  </form>;
}

export function PocketInvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const router=useRouter(); const [invoice,setInvoice]=useState<PocketInvoiceView|null>(null); const [error,setError]=useState(""); const [busy,setBusy]=useState(""); const {value}=useEntitlements();
  const reload=useCallback(()=>api<{invoice:PocketInvoiceView}>(`/api/pocket/invoices/${invoiceId}`).then((result)=>setInvoice(result.invoice)),[invoiceId]);
  useEffect(()=>{void reload().catch((cause)=>setError(cause instanceof Error?cause.message:"Invoice unavailable."));},[reload]);
  async function action(name:"issue"|"convert"|"cancel") { if(!invoice)return;setBusy(name);setError("");try{if(name==="cancel")await api(`/api/pocket/invoices/${invoice.id}`,{method:"PATCH",body:JSON.stringify({action:"cancel"})});else await api(`/api/pocket/invoices/${invoice.id}/${name}`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:name==="issue"?JSON.stringify({expectedVersion:invoice.version}):undefined});await reload();router.refresh();}catch(cause){setError(cause instanceof Error?cause.message:"Action failed.");}finally{setBusy("");}}
  async function share(){if(!invoice)return;setBusy("share");setError("");try{const blob=await requestBlob(`/api/pocket/invoices/${invoice.id}/pdf`,{},"The invoice PDF is unavailable.");const file=new File([blob],`${invoice.invoiceNumber??"invoice-draft"}.pdf`,{type:"application/pdf"});const message=invoiceWhatsAppMessage(invoice.invoiceNumber??"draft",formatCurrencyMinor(invoice.totalMinor,invoice.currency),invoice.businessName);const shareData={title:invoice.invoiceNumber??"Invoice draft",text:message,files:[file]};if(navigator.share&&navigator.canShare?.({files:[file]})){await navigator.share(shareData);}else{const download=document.createElement("a");download.href=URL.createObjectURL(blob);download.download=file.name;download.click();setTimeout(()=>URL.revokeObjectURL(download.href),1000);window.open(`https://wa.me/?text=${encodeURIComponent(message)}`,"_blank","noopener,noreferrer");}await api(`/api/pocket/invoices/${invoice.id}/whatsapp`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:"{}"});}catch(cause){if(cause instanceof DOMException&&cause.name==="AbortError")return;setError(cause instanceof Error?cause.message:"Share handoff failed.");}finally{setBusy("");}}
  const usage=value?.capabilities["pocket.invoice.create"]; const canWrite=Boolean(usage?.enabled);
  const paid=invoice?.paidMinor??0; const remaining=invoice?.remainingMinor??invoice?.totalMinor??0;
  if(!invoice)return error?<PocketUnavailable/>:<p role="status" className="py-12 text-center text-sm font-semibold text-slate-500">Loading invoice...</p>;
  return <div className="space-y-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-bold text-[#087F5B]">Simple Invoice</p><h1 className="mt-2 text-3xl font-black text-[#092F2A]">{invoice.invoiceNumber??"Draft invoice"}</h1><p className="mt-2 text-sm text-slate-500">{invoice.customerName} - due {invoice.dueDate}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase text-slate-700">{invoice.status.replaceAll("_"," ")}</span></div>
    <div className="grid gap-4 sm:grid-cols-3"><Metric label="Total" value={formatCurrencyMinor(invoice.totalMinor,invoice.currency)}/><Metric label="Paid from shared ledger" value={formatCurrencyMinor(paid,invoice.currency)}/><Metric label="Remaining from shared ledger" value={formatCurrencyMinor(remaining,invoice.currency)}/></div>
    <div className="overflow-hidden rounded-3xl border border-emerald-950/10 bg-white"><div className="grid grid-cols-[1fr_auto] gap-4 bg-slate-50 px-5 py-3 text-xs font-bold uppercase text-slate-500"><span>Item</span><span>Amount</span></div>{invoice.items.map((item)=><div key={item.position} className="grid grid-cols-[1fr_auto] gap-4 border-t border-slate-100 px-5 py-4 text-sm"><span><strong className="text-[#092F2A]">{item.description}</strong><span className="mt-1 block text-slate-500">{formatInvoiceQuantity(item.quantityMilli)} x {formatCurrencyMinor(item.unitPriceMinor,invoice.currency)}</span></span><strong>{formatCurrencyMinor(item.lineTotalMinor,invoice.currency)}</strong></div>)}</div>
    <Disclaimer/>{!canWrite&&invoice.status==="draft"?<p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-950">This draft remains readable, but add-on access is required to edit or issue it.</p>:null}{usage?.limit===60&&usage.used===60?<p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-950">Pocket&apos;s hard maximum is 60 issued invoices per cycle. Upgrade to Solo for higher-volume or formal invoicing workflows.</p>:null}
    {error?<p role="alert" className="rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-800">{error}</p>:null}<div className="flex flex-wrap gap-3"><a className={primary} href={`/api/pocket/invoices/${invoice.id}/pdf`} target="_blank" rel="noreferrer">{invoice.status==="draft"?"Preview PDF":"Create PDF"}</a>{invoice.status==="draft"&&canWrite?<><Link className={secondary} href={`/pocket/invoices/${invoice.id}/edit`}>Edit</Link><button className={secondary} disabled={Boolean(busy)} onClick={()=>void action("issue")}>{busy==="issue"?"Issuing...":"Issue Invoice"}</button></>:null}{invoice.status==="issued"&&!invoice.debtId&&canWrite?<button className={secondary} disabled={Boolean(busy)} onClick={()=>void action("convert")}>{busy==="convert"?"Linking...":"Convert to Debt"}</button>:null}{invoice.debtId&&invoice.status!=="paid"?<Link className={secondary} href={`/pocket/payments/new?customerId=${invoice.customerId}&debtId=${invoice.debtId}`}>Record Payment</Link>:null}{invoice.status!=="draft"?<button className={secondary} disabled={Boolean(busy)} onClick={()=>void share()}>{busy==="share"?"Preparing...":"Share WhatsApp"}</button>:null}{invoice.status==="issued"&&!invoice.debtId&&canWrite?<button className={secondary} disabled={Boolean(busy)} onClick={()=>void action("cancel")}>Cancel Invoice</button>:null}<Link className={secondary} href="/pocket/invoices">Back</Link></div>
  </div>;
}

function Metric({label,value}:{label:string;value:string}) { return <div className="rounded-3xl border border-emerald-950/10 bg-white p-5"><p className="text-sm font-semibold text-slate-500">{label}</p><p className="mt-2 text-xl font-black text-[#092F2A]">{value}</p></div>; }
function Disclaimer(){return <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs font-black tracking-wide text-red-900">{POCKET_INVOICE_DISCLAIMER}. No LHDN submission or government integration is included.</p>}
