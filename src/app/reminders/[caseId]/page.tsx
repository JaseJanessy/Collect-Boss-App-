import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { ReminderGeneratorPage } from "@/components/pages/reminder-generator-page";

interface Props {
  params: Promise<{ caseId: string }>;
}

export default async function ReminderRoute({ params }: Props) {
  const { caseId } = await params;
  return (
    <>
      <MobileShell hideHeader>
        <ReminderGeneratorPage caseId={caseId} />
      </MobileShell>
      <DashboardShell>
        <ReminderGeneratorPage caseId={caseId} />
      </DashboardShell>
    </>
  );
}
