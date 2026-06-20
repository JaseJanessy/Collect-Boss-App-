import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { ActionsPage } from "@/components/pages/actions-page";

export default function Actions() {
  return (
    <>
      <MobileShell>
        <ActionsPage />
      </MobileShell>
      <DashboardShell>
        <ActionsPage dashboard />
      </DashboardShell>
    </>
  );
}
