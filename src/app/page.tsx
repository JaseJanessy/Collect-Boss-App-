import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { HomeMobile } from "@/components/pages/home-mobile";
import { HomeDashboard } from "@/components/pages/home-dashboard";

export default function HomePage() {
  return (
    <>
      <MobileShell>
        <HomeMobile />
      </MobileShell>
      <DashboardShell>
        <HomeDashboard />
      </DashboardShell>
    </>
  );
}
