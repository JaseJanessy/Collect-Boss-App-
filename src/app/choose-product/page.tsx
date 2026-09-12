import type { Metadata } from "next";

import { ProductSelectionPage } from "@/components/pages/auth/product-selection-page";
import { PLAN_ORDER } from "@/lib/billing/plans";
import type { PlanSlug } from "@/lib/billing/types";

export const metadata: Metadata = {
  title: "Choose CollectBoss Product",
  description: "Choose CollectBoss or CollectBoss Pocket for your shared account.",
  robots: { index: false, follow: false },
};

export default async function ChooseProductRoute({ searchParams }: { searchParams: Promise<{ plan?: string; product?: string }> }) {
  const { plan, product } = await searchParams;
  const selectedPlan = PLAN_ORDER.includes(plan as PlanSlug) ? plan as PlanSlug : undefined;
  const preferredProduct = product === "pocket" ? "pocket" as const : undefined;
  return <ProductSelectionPage selectedPlan={selectedPlan} preferredProduct={preferredProduct} />;
}
