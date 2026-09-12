import { NextResponse } from "next/server";

import { requirePocketBillingAccess } from "@/lib/billing/pocket-entitlements";
import { loadPocketSoloUpgrade, PocketSoloUpgradeError } from "@/lib/pocket/upgrade-server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };

export async function GET() {
  const access = await requirePocketBillingAccess("billing.manage");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  try {
    return NextResponse.json(await loadPocketSoloUpgrade(access), { headers });
  } catch (error) {
    const status = error instanceof PocketSoloUpgradeError ? error.status : 503;
    const code = error instanceof PocketSoloUpgradeError ? error.code : "POCKET_UPGRADE_UNAVAILABLE";
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upgrade status is unavailable.", code }, { status, headers });
  }
}
