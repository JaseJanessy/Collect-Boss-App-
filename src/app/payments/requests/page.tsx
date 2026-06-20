import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { PaymentRequestsPage } from "@/components/pages/payments/payment-requests-page";

export default function PaymentRequests() {
  return (
    <>
      <MobileShell hideHeader>
        <PaymentRequestsPage />
      </MobileShell>
      <DashboardShell>
        <PaymentRequestsPage />
      </DashboardShell>
    </>
  );
}
