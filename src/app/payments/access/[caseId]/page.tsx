import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { PaymentAccessSettingsPage } from "@/components/pages/payments/payment-access-settings-page";

interface Props {
  params: Promise<{ caseId: string }>;
}

export default async function PaymentAccessRoute({ params }: Props) {
  const { caseId } = await params;
  return (
    <>
      <MobileShell hideHeader>
        <PaymentAccessSettingsPage caseId={caseId} />
      </MobileShell>
      <DashboardShell>
        <PaymentAccessSettingsPage caseId={caseId} />
      </DashboardShell>
    </>
  );
}
