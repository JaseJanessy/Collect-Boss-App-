import { DashboardShell } from "@/components/shells/dashboard-shell";
import { MobileShell } from "@/components/shells/mobile-shell";
import { NotificationsPage } from "@/components/pages/notifications-page";

export default function Notifications() {
  return (
    <>
      <MobileShell><NotificationsPage /></MobileShell>
      <DashboardShell><NotificationsPage dashboard /></DashboardShell>
    </>
  );
}
