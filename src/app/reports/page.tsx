import { DashboardShell } from "@/components/shells/dashboard-shell";
import { MobileShell } from "@/components/shells/mobile-shell";
import { ReportsPage } from "@/components/pages/reports-page";

export default function Reports() {
  return (
    <>
      <MobileShell>
        <div className="px-4 pt-5 pb-6">
          <ReportsPage />
        </div>
      </MobileShell>
      <DashboardShell>
        <ReportsPage />
      </DashboardShell>
    </>
  );
}
