import { PocketInvoiceDetail } from "@/components/pocket/pocket-invoices";

export default async function PocketInvoicePage({params}:{params:Promise<{invoiceId:string}>}) { const {invoiceId}=await params; return <PocketInvoiceDetail invoiceId={invoiceId}/>; }

