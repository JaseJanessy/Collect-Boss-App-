import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { ApproveRequestPage } from "@/components/pages/payments/approve-request-page";

interface Props {
  params: Promise<{ requestId: string }>;
}

export default async function ApproveRequestRoute({ params }: Props) {
  const { requestId } = await params;
  return (
    <>
      <MobileShell hideHeader>
        <ApproveRequestPage requestId={requestId} />
      </MobileShell>
      <DashboardShell>
        <ApproveRequestPage requestId={requestId} />
      </DashboardShell>
    </>
  );
}
