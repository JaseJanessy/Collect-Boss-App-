import { DashboardShell } from "@/components/shells/dashboard-shell";
import { MobileShell } from "@/components/shells/mobile-shell";
import { StatementsPage } from "@/components/pages/statements-page";

export default function Statements() {
  return (
    <>
      <MobileShell><StatementsPage /></MobileShell>
      <DashboardShell><StatementsPage /></DashboardShell>
    </>
  );
}
