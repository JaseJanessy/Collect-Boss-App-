import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { ActionCentrePage } from "@/components/pages/action-centre-page";

export default function Actions() {
  return (
    <>
      <MobileShell>
        <ActionCentrePage />
      </MobileShell>
      <DashboardShell>
        <ActionCentrePage dashboard />
      </DashboardShell>
    </>
  );
}
