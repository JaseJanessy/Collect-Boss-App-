import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { CasesPage } from "@/components/pages/cases-page";

export default function Cases() {
  return (
    <>
      <MobileShell>
        <CasesPage />
      </MobileShell>
      <DashboardShell>
        <CasesPage dashboard />
      </DashboardShell>
    </>
  );
}
