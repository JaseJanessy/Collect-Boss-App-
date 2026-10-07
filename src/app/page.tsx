import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { HomeMobile } from "@/components/pages/home-mobile";
import { HomeDashboard } from "@/components/pages/home-dashboard";
import { requireWorkspaceContext } from "@/lib/workspace/context";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { getServerClient, hasServerAuthCookie } from "@/lib/supabase/server-client";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (isSupabaseConfigured && await hasServerAuthCookie()) {
    const client = await getServerClient();
    const { data: { user } } = client
      ? await client.auth.getUser()
      : { data: { user: null } };
    if (!user) redirect("/landing");
  } else if (isSupabaseConfigured) {
    redirect("/landing");
  }

  const workspaceResult = await requireWorkspaceContext();
  if ("error" in workspaceResult) {
    if (workspaceResult.code === "WORKSPACE_ACCESS_DENIED") redirect("/choose-product");
    // Keep the authenticated entry point usable while workspace provisioning
    // is incomplete. Let the user choose Main or Pocket and continue setup.
    redirect("/choose-product");
  }
  if (workspaceResult.context.workspace.productType === "pocket") redirect("/pocket");

  return (
    <>
      <MobileShell>
        <HomeMobile />
      </MobileShell>
      <DashboardShell>
        <HomeDashboard />
      </DashboardShell>
    </>
  );
}
