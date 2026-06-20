import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { RecordPaymentPage } from "@/components/pages/payments/record-payment-page";

interface Props {
  params: Promise<{ caseId: string }>;
}

export default async function RecordPaymentRoute({ params }: Props) {
  const { caseId } = await params;
  return (
    <>
      <MobileShell hideHeader>
        <RecordPaymentPage caseId={caseId} />
      </MobileShell>
      <DashboardShell>
        <RecordPaymentPage caseId={caseId} />
      </DashboardShell>
    </>
  );
}
