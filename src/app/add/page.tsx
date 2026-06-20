import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { AddCasePage } from "@/components/pages/add-case-page";

export default function Add() {
  return (
    <>
      <MobileShell hideHeader>
        <AddCasePage />
      </MobileShell>
      <DashboardShell>
        <AddCasePage />
      </DashboardShell>
    </>
  );
}
