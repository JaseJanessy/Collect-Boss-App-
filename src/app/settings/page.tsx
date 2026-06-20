import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { BusinessSettingsPage } from "@/components/pages/business-settings-page";

export default function SettingsPage() {
  return (
    <>
      <MobileShell>
        <BusinessSettingsPage />
      </MobileShell>
      <DashboardShell>
        <BusinessSettingsPage dashboard />
      </DashboardShell>
    </>
  );
}
