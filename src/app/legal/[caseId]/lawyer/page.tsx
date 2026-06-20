import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { LawyerReferralPage } from "@/components/pages/legal/lawyer-referral-page";
import { mockCases } from "@/lib/mock-data";

interface Props { params: Promise<{ caseId: string }> }

export function generateStaticParams() {
  return mockCases.map((c) => ({ caseId: c.id }));
}

export default async function LawyerPage({ params }: Props) {
  const { caseId } = await params;
  return (
    <>
      <MobileShell hideHeader><LawyerReferralPage caseId={caseId} /></MobileShell>
      <DashboardShell><LawyerReferralPage caseId={caseId} /></DashboardShell>
    </>
  );
}
