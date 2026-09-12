import type { Metadata } from "next";

import { PocketShell } from "@/components/pocket/pocket-shell";
import { PocketPermissionDenied, PocketUnavailable } from "@/components/pocket/pocket-states";
import { PocketWorkspaceProvider } from "@/components/pocket/pocket-workspace-provider";
import { requireWorkspaceContext } from "@/lib/workspace/context";

export const metadata: Metadata = {
  title: { default: "Pocket", template: "%s | CollectBoss Pocket" },
  description: "A simple way to keep track of customer debts and payments.",
  manifest: "/pocket/manifest.webmanifest",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function PocketLayout({ children }: { children: React.ReactNode }) {
  const result = await requireWorkspaceContext("pocket");
  if ("error" in result) return result.status === 403 ? <PocketPermissionDenied /> : <PocketUnavailable />;
  if (result.context.workspace.productType !== "pocket") return <PocketPermissionDenied />;

  return (
    <PocketWorkspaceProvider value={result.context}>
      <PocketShell>{children}</PocketShell>
    </PocketWorkspaceProvider>
  );
}
