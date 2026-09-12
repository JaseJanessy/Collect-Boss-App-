import { NextRequest, NextResponse } from "next/server";

import { loadPocketEntitlements, requirePocketBillingAccess, requirePocketMobileBillingAccess } from "@/lib/billing/pocket-entitlements";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = (request.headers.get("authorization") ?? "").startsWith("Bearer ")
    ? await requirePocketMobileBillingAccess(request, "case.read")
    : await requirePocketBillingAccess("case.read");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers: { "Cache-Control": "no-store" } });
  const result = await loadPocketEntitlements(access);
  if ("error" in result) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(result.entitlements, { headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" } });
}
