import Link from "next/link";
import { ScanLine } from "lucide-react";
import { PocketRecordPayment } from "@/components/pocket/pocket-payments";
import { PocketPageHeader, pocketSecondaryActionClass } from "@/components/pocket/pocket-ui";

export default async function NewPocketPaymentPage({searchParams}:{searchParams:Promise<{customerId?:string;debtId?:string}>}) {
  const{customerId,debtId}=await searchParams;
  return <section aria-labelledby="record-payment-title"><PocketPageHeader id="record-payment-title" eyebrow="Money received" title="Record Payment" description="Enter the amount, review the latest balance, then confirm once." action={<Link href="/pocket/receipts/scan" className={pocketSecondaryActionClass}><ScanLine aria-hidden="true" className="size-5"/>Scan Receipt</Link>}/><PocketRecordPayment initialCustomerId={customerId} initialDebtId={debtId}/></section>;
}
