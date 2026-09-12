import { PocketDebtForm } from "@/components/pocket/pocket-ledger";
import { PocketPageHeader } from "@/components/pocket/pocket-ui";

export default async function NewPocketDebtPage({searchParams}:{searchParams:Promise<{customerId?:string}>}) {
  const {customerId}=await searchParams;
  return <section aria-labelledby="new-debt-title" className="mx-auto max-w-3xl"><PocketPageHeader id="new-debt-title" eyebrow="Debt" title="Add Debt" description="Record who owes you, the amount, and what it is for."/><PocketDebtForm initialCustomerId={customerId} /></section>;
}
