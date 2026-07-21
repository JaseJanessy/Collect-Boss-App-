import { DebtorsPage } from "@/components/pages/debtors-page";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { MobileShell } from "@/components/shells/mobile-shell";

export default function Debtors() {
  return <>
    <MobileShell><DebtorsPage /></MobileShell>
    <DashboardShell><DebtorsPage /></DashboardShell>
  </>;
}
