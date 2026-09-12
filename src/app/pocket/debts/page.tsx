import Link from "next/link";
import { Plus } from "lucide-react";
import { PocketDebtList } from "@/components/pocket/pocket-ledger";
import { PocketPageHeader, pocketPrimaryActionClass } from "@/components/pocket/pocket-ui";

export default function PocketDebtsPage() {
  return <section aria-labelledby="debts-title"><PocketPageHeader id="debts-title" eyebrow="Simple debt list" title="Who Owes Me" description="Remaining amounts and overdue debts are visible at a glance." action={<Link href="/pocket/debts/new" className={pocketPrimaryActionClass}><Plus aria-hidden="true" className="size-5"/>Add Debt</Link>}/><PocketDebtList /></section>;
}
