import { BusinessProfilePage } from "@/components/pages/onboarding/business-profile-page";
import { PLAN_ORDER } from "@/lib/billing/plans";
import type { PlanSlug } from "@/lib/billing/types";

export default async function OnboardingProfile({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const { plan } = await searchParams;
  const selectedPlan = PLAN_ORDER.includes(plan as PlanSlug) ? plan as PlanSlug : undefined;
  return <BusinessProfilePage selectedPlan={selectedPlan} />;
}
