import { PocketCustomerForm } from "@/components/pocket/pocket-ledger";
import { PocketPageHeader } from "@/components/pocket/pocket-ui";

export default function NewPocketCustomerPage() {
  return <section aria-labelledby="new-customer-title" className="mx-auto max-w-3xl"><PocketPageHeader id="new-customer-title" eyebrow="Customer" title="Add Customer" description="Start with their name. Contact details can be added now or later."/><PocketCustomerForm /></section>;
}
