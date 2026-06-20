import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { FormalDemandPage } from "@/components/pages/legal/formal-demand-page";
import { mockCases } from "@/lib/mock-data";

interface Props { params: Promise<{ caseId: string }> }

export function generateStaticParams() {
  return mockCases.map((c) => ({ caseId: c.id }));
}

export default async function DemandPage({ params }: Props) {
  const { caseId } = await params;
  return (
    <>
      <MobileShell hideHeader><FormalDemandPage caseId={caseId} /></MobileShell>
      <DashboardShell><FormalDemandPage caseId={caseId} /></DashboardShell>
    </>
  );
}
