import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { EvidenceChecklistPage } from "@/components/pages/legal/evidence-checklist-page";

interface Props { params: Promise<{ caseId: string }> }

export default async function ChecklistRoute({ params }: Props) {
  const { caseId } = await params;
  return (
    <>
      <MobileShell hideHeader>
        <EvidenceChecklistPage caseId={caseId} />
      </MobileShell>
      <DashboardShell>
        <EvidenceChecklistPage caseId={caseId} />
      </DashboardShell>
    </>
  );
}
