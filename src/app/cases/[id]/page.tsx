import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { CaseDetailPage } from "@/components/pages/case-detail-page";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CaseDetailRoute({ params }: Props) {
  const { id } = await params;

  return (
    <>
      <MobileShell hideHeader>
        <CaseDetailPage caseId={id} />
      </MobileShell>
      <DashboardShell>
        <CaseDetailPage caseId={id} />
      </DashboardShell>
    </>
  );
}
