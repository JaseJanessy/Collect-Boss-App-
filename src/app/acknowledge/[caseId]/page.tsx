import { DebtorAcknowledgementPage } from "@/components/pages/legal/debtor-acknowledgement-page";
import { PublicAccessStatusPage } from "@/components/pages/public/public-access-status-page";
import { resolvePublicAcknowledgement } from "@/lib/public-access/service";

interface Props { params: Promise<{ caseId: string }>; }

export const dynamic = "force-dynamic";

export default async function AcknowledgePage({ params }: Props) {
  const { caseId: token } = await params;
  const result = await resolvePublicAcknowledgement(token);
  if (result.state !== "valid") {
    return <PublicAccessStatusPage state={result.state} action="acknowledgement" />;
  }

  return <DebtorAcknowledgementPage token={token} plan={result.data} />;
}
