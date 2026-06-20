import { notFound } from "next/navigation";
import { getCaseById } from "@/lib/db/cases";
import {
  DebtorPaymentPage,
  type PublicCaseInfo,
} from "@/components/pages/payments/debtor-payment-page";

interface Props {
  params: Promise<{ caseId: string }>;
}

export const dynamic = "force-dynamic";

export default async function DebtorPayment({ params }: Props) {
  const { caseId } = await params;

  // Fetch limited, safe case data server-side
  const result = await getCaseById(caseId);
  if (result.error || !result.data) notFound();

  const c = result.data;

  // Only expose safe public fields — never bank details here
  const caseInfo: PublicCaseInfo = {
    id:                c.id,
    debtor_name:       c.debtor_name,
    debtor_company:    c.debtor_company,
    balance:           c.balance,
    amount_owed:       c.amount_owed,
    due_date:          c.due_date,
    invoice_no:        c.invoice_no,
    payment_lock_mode: c.payment_lock_mode,
  };

  return <DebtorPaymentPage caseInfo={caseInfo} />;
}
