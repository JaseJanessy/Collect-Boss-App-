import { PocketUpgradePanel } from "@/components/pocket/pocket-upgrade-panel";
import { PocketPageHeader } from "@/components/pocket/pocket-ui";

export default function PocketUpgradePage() {
  return (
    <section aria-labelledby="pocket-upgrade-title" className="mx-auto max-w-3xl">
      <PocketPageHeader
        id="pocket-upgrade-title"
        eyebrow="Pocket account"
        title="Upgrade to CollectBoss Solo"
        description="Move this workspace into Solo without creating a second account or copying financial records."
      />
      <PocketUpgradePanel />
    </section>
  );
}
