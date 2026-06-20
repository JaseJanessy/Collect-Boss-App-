import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { EvidenceUploadPage } from "@/components/pages/legal/evidence-upload-page";

interface Props { params: Promise<{ caseId: string }> }

export default async function EvidenceRoute({ params }: Props) {
  const { caseId } = await params;
  return (
    <>
      <MobileShell hideHeader>
        <EvidenceUploadPage caseId={caseId} />
      </MobileShell>
      <DashboardShell>
        <EvidenceUploadPage caseId={caseId} />
      </DashboardShell>
    </>
  );
}
