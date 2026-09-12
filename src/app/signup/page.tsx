import { SignupPage } from "@/components/pages/auth/signup-page";
import { PLAN_ORDER } from "@/lib/billing/plans";
import type { PlanSlug } from "@/lib/billing/types";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { getServerClient, hasServerAuthCookie } from "@/lib/supabase/server-client";

export const dynamic = "force-dynamic";

export default async function Signup({ searchParams }: { searchParams: Promise<{ plan?: string; product?: string }> }) {
  if (isSupabaseConfigured && await hasServerAuthCookie()) {
    const client = await getServerClient();
    const { data: { user } } = client ? await client.auth.getUser() : { data: { user: null } };
    if (user) redirect("/");
  }
  const { plan, product } = await searchParams;
  const selectedPlan = PLAN_ORDER.includes(plan as PlanSlug) ? plan as PlanSlug : undefined;
  const preferredProduct = product === "pocket" ? "pocket" as const : undefined;
  return <SignupPage selectedPlan={selectedPlan} preferredProduct={preferredProduct} />;
}
