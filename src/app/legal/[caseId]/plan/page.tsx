import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { PaymentPlanPage } from "@/components/pages/legal/payment-plan-page";
import { mockCases } from "@/lib/mock-data";

interface Props { params: Promise<{ caseId: string }> }

export function generateStaticParams() {
  return mockCases.map((c) => ({ caseId: c.id }));
}

export default async function PlanPage({ params }: Props) {
  const { caseId } = await params;
  return (
    <>
      <MobileShell hideHeader><PaymentPlanPage caseId={caseId} /></MobileShell>
      <DashboardShell><PaymentPlanPage caseId={caseId} /></DashboardShell>
    </>
  );
}
