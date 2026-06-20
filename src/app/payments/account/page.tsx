import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { ReceivingAccountPage } from "@/components/pages/payments/receiving-account-page";

export default function ReceivingAccount() {
  return (
    <>
      <MobileShell hideHeader>
        <ReceivingAccountPage />
      </MobileShell>
      <DashboardShell>
        <ReceivingAccountPage />
      </DashboardShell>
    </>
  );
}
