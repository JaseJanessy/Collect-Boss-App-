import { DebtorPaymentPage } from "@/components/pages/payments/debtor-payment-page";
import { PublicAccessStatusPage } from "@/components/pages/public/public-access-status-page";
import { resolvePublicPayment } from "@/lib/public-access/service";

interface Props { params: Promise<{ caseId: string }>; }

export const dynamic = "force-dynamic";

export default async function DebtorPayment({ params }: Props) {
  // The URL segment is retained to avoid an unrelated route migration, but the
  // value is an opaque capability token, never a case ID.
  const { caseId: token } = await params;
  const result = await resolvePublicPayment(token);
  if (result.state !== "valid") {
    return <PublicAccessStatusPage state={result.state} action="payment" />;
  }

  return <DebtorPaymentPage token={token} payment={result.data} />;
}
