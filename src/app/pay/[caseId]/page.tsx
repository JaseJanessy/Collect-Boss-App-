import { DebtorPaymentPage } from "@/components/pages/payments/debtor-payment-page";
import { PublicAccessStatusPage } from "@/components/pages/public/public-access-status-page";
import { paymentSessionCookieName } from "@/lib/payment-access/service";
import { resolvePublicPayment } from "@/lib/public-access/service";
import { cookies } from "next/headers";
import { headers } from "next/headers";
import { enforcePublicRateLimit } from "@/lib/api/public-rate-limit";

interface Props { params: Promise<{ caseId: string }>; }

export const dynamic = "force-dynamic";

export default async function DebtorPayment({ params }: Props) {
  // The URL segment is retained to avoid an unrelated route migration, but the
  // value is an opaque capability token, never a case ID.
  const { caseId: token } = await params;
  const rateLimit = await enforcePublicRateLimit({ headers: await headers(), rawToken: token, action: "payment-page", limit: 30 });
  if (!rateLimit.allowed) return <PublicAccessStatusPage state="unavailable" action="payment" />;
  const cookieStore = await cookies();
  const paymentSession = cookieStore.get(paymentSessionCookieName(token))?.value ?? null;
  const result = await resolvePublicPayment(token, paymentSession);
  if (result.state !== "valid") {
    return <PublicAccessStatusPage state={result.state} action="payment" />;
  }

  return <DebtorPaymentPage token={token} payment={result.data} />;
}
