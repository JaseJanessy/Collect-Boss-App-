import type { Metadata } from "next";
import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { BillingPage } from "@/components/pages/billing-page";
import { PLAN_ORDER } from "@/lib/billing/plans";
import type { PlanSlug } from "@/lib/billing/types";

export const metadata: Metadata = {
  title: "Billing & Plan",
};

export default async function BillingRoute({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const { plan } = await searchParams;
  const selectedPlan = PLAN_ORDER.includes(plan as PlanSlug) ? plan as PlanSlug : undefined;
  return (
    <>
      <MobileShell>
        <BillingPage selectedPlan={selectedPlan} />
      </MobileShell>
      <DashboardShell>
        <BillingPage dashboard selectedPlan={selectedPlan} />
      </DashboardShell>
    </>
  );
}
