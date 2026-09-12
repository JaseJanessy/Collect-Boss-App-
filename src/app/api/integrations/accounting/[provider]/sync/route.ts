import { NextRequest, NextResponse } from "next/server";
import { appendSensitiveAudit, requireTenantPermission } from "@/lib/auth/tenant-access";
import { syncAccountingConnection, type AccountingSyncMode } from "@/lib/accounting/sync";
import { accountingProviders, type AccountingProvider } from "@/lib/accounting/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const access = await requireTenantPermission("settings.sensitive.manage");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const rawProvider = (await params).provider;
  if (!accountingProviders.includes(rawProvider as AccountingProvider)) {
    return NextResponse.json({ error: "Unsupported accounting provider." }, { status: 404 });
  }
  const provider = rawProvider as AccountingProvider;
  const body = await request.json().catch(() => ({})) as { mode?: unknown };
  const requestedMode = body.mode;
  const mode: AccountingSyncMode = requestedMode === "preview" || requestedMode === "full" || requestedMode === "incremental"
    ? requestedMode : "incremental";
  const { data: connection } = await access.service.from("accounting_connections").select("id,last_successful_sync_at")
    .eq("business_id", access.businessId).eq("provider", provider).maybeSingle();
  if (!connection) return NextResponse.json({ error: "Connect this provider before syncing." }, { status: 404 });
  const effectiveMode = mode === "incremental" && !connection.last_successful_sync_at ? "full" : mode;
  try {
    const result = await syncAccountingConnection(String(connection.id), effectiveMode);
    await appendSensitiveAudit({
      access, request, action: effectiveMode === "preview" ? "accounting.sync_previewed" : "accounting.sync_completed",
      entityType: "accounting_connection", entityId: String(connection.id),
      metadata: { provider, mode: effectiveMode, counts: result.counts },
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Accounting sync failed." }, { status: 409 });
  }
}
