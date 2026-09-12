import { PocketInvoiceList } from "@/components/pocket/pocket-invoices";
import { PocketPageHeader } from "@/components/pocket/pocket-ui";

export default function PocketInvoicesPage() {
  return <section aria-labelledby="pocket-invoices-title"><PocketPageHeader id="pocket-invoices-title" eyebrow="Optional add-on" title="Simple Invoices" description="Create, preview, share, and track usage without exposing Solo workflows."/><PocketInvoiceList/></section>;
}
