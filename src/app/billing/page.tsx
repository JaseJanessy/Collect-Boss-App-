import type { Metadata } from "next";
import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { BillingPage } from "@/components/pages/billing-page";

export const metadata: Metadata = {
  title: "Billing & Plan",
};

export default function BillingRoute() {
  return (
    <>
      <MobileShell>
        <BillingPage />
      </MobileShell>
      <DashboardShell>
        <BillingPage dashboard />
      </DashboardShell>
    </>
  );
}
