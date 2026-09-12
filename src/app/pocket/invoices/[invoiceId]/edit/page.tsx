import { PocketInvoiceForm } from "@/components/pocket/pocket-invoices";

export default async function PocketEditInvoicePage({params}:{params:Promise<{invoiceId:string}>}) { const {invoiceId}=await params; return <section aria-labelledby="edit-invoice-title" className="mx-auto max-w-4xl"><p className="text-sm font-bold text-[#087F5B]">Simple Invoice</p><h1 id="edit-invoice-title" className="mt-2 text-3xl font-black text-[#092F2A]">Edit draft</h1><PocketInvoiceForm invoiceId={invoiceId}/></section>; }

