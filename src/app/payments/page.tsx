import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { PaymentHistoryPage } from "@/components/pages/payments/payment-history-page";

export default function PaymentsPage() {
  return (
    <>
      <MobileShell>
        <PaymentHistoryPage />
      </MobileShell>
      <DashboardShell>
        <PaymentHistoryPage />
      </DashboardShell>
    </>
  );
}
