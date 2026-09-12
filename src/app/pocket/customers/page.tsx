import Link from "next/link";
import { Plus } from "lucide-react";
import { PocketCustomers } from "@/components/pocket/pocket-ledger";
import { PocketPageHeader, pocketPrimaryActionClass } from "@/components/pocket/pocket-ui";

export default function PocketCustomersPage() {
  return <section aria-labelledby="pocket-customers-title"><PocketPageHeader id="pocket-customers-title" eyebrow="People you know" title="Customers" description="Names, contact details, and balances—kept simple." action={<Link href="/pocket/customers/new" className={pocketPrimaryActionClass}><Plus aria-hidden="true" className="size-5"/>Add Customer</Link>}/><PocketCustomers /></section>;
}
