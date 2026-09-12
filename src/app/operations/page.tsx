import { OperationsPage } from "@/components/pages/operations-page";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { MobileShell } from "@/components/shells/mobile-shell";

export default function Operations() {
  return (
    <>
      <MobileShell><OperationsPage /></MobileShell>
      <DashboardShell><OperationsPage dashboard /></DashboardShell>
    </>
  );
}

