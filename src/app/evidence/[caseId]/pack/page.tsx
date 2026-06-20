import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { EvidencePackPage } from "@/components/pages/legal/evidence-pack-page";

interface Props { params: Promise<{ caseId: string }> }

export default async function EvidencePackRoute({ params }: Props) {
  const { caseId } = await params;
  return (
    <>
      <MobileShell hideHeader>
        <EvidencePackPage caseId={caseId} />
      </MobileShell>
      <DashboardShell>
        <EvidencePackPage caseId={caseId} />
      </DashboardShell>
    </>
  );
}
