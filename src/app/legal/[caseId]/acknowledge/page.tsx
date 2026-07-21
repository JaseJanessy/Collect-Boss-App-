import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { DebtAcknowledgementPage } from "@/components/pages/legal/debt-acknowledgement-page";
import { mockCases } from "@/lib/mock-data";
import { isMockDataEnabled } from "@/lib/supabase/client";

interface Props { params: Promise<{ caseId: string }> }

export function generateStaticParams() {
  return isMockDataEnabled ? mockCases.map((c) => ({ caseId: c.id })) : [];
}

export default async function AcknowledgePage({ params }: Props) {
  const { caseId } = await params;
  return (
    <>
      <MobileShell hideHeader><DebtAcknowledgementPage caseId={caseId} /></MobileShell>
      <DashboardShell><DebtAcknowledgementPage caseId={caseId} /></DashboardShell>
    </>
  );
}
