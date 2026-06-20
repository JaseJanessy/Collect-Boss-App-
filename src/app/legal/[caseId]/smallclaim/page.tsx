import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { SmallClaimPage } from "@/components/pages/legal/small-claim-page";
import { mockCases } from "@/lib/mock-data";

interface Props { params: Promise<{ caseId: string }> }

export function generateStaticParams() {
  return mockCases.map((c) => ({ caseId: c.id }));
}

export default async function SmallClaimRoute({ params }: Props) {
  const { caseId } = await params;
  return (
    <>
      <MobileShell hideHeader><SmallClaimPage caseId={caseId} /></MobileShell>
      <DashboardShell><SmallClaimPage caseId={caseId} /></DashboardShell>
    </>
  );
}
