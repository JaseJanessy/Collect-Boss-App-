import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { ControlledLawyerReferralPage } from "@/components/pages/legal/controlled-lawyer-referral-page";
import { mockCases } from "@/lib/mock-data";
import { isMockDataEnabled } from "@/lib/supabase/client";

interface Props { params: Promise<{ caseId: string }> }

export function generateStaticParams() {
  return isMockDataEnabled ? mockCases.map((c) => ({ caseId: c.id })) : [];
}

export default async function LawyerPage({ params }: Props) {
  const { caseId } = await params;
  return (
    <>
      <MobileShell hideHeader><ControlledLawyerReferralPage caseId={caseId} /></MobileShell>
      <DashboardShell><ControlledLawyerReferralPage caseId={caseId} /></DashboardShell>
    </>
  );
}
