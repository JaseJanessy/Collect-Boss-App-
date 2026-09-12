import { NextRequest, NextResponse } from "next/server";
import { appendSensitiveAudit, requireTenantPermission } from "@/lib/auth/tenant-access";
import { decryptAccountingSecret } from "@/lib/accounting/crypto";
import { getAccountingAdapter } from "@/lib/accounting/providers";
import type { AccountingConnectionRecord, PublicAccountingConnection } from "@/lib/accounting/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function publicConnection(row: AccountingConnectionRecord): PublicAccountingConnection {
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    organizationName: row.organization_name,
    scopes: row.scopes ?? [],
    lastSuccessfulSyncAt: row.last_successful_sync_at,
    lastAttemptedSyncAt: row.last_attempted_sync_at,
    lastError: row.last_error_message,
  };
}

export async function GET() {
  const access = await requireTenantPermission("settings.sensitive.manage");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { data, error } = await access.service.from("accounting_connections").select("*")
    .eq("business_id", access.businessId).order("provider");
  if (error) return NextResponse.json({ error: "Unable to load accounting integrations." }, { status: 500 });
  const connections = ((data ?? []) as AccountingConnectionRecord[]).map(publicConnection);
  const { data: runs } = await access.service.from("accounting_sync_runs")
    .select("id,connection_id,provider,mode,status,counts,preview,errors,started_at,finished_at")
    .eq("business_id", access.businessId).order("started_at", { ascending: false }).limit(10);
  const [{ data: health }, { data: jobs }] = await Promise.all([
    access.service.from("integration_health").select("provider,status,last_checked_at,last_success_at,last_failure_at,consecutive_failures,error_code,actionable_message")
      .eq("business_id", access.businessId).in("provider", ["xero", "quickbooks"]),
    access.service.from("integration_jobs").select("id,provider,job_type,status,attempts,max_attempts,next_attempt_at,last_error_code,last_error_message,created_at")
      .eq("business_id", access.businessId).in("provider", ["xero", "quickbooks"])
      .in("status", ["retry_scheduled", "dead_letter"]).order("created_at", { ascending: false }).limit(20),
  ]);
  return NextResponse.json({ connections, runs: runs ?? [], health: health ?? [], jobs: jobs ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: NextRequest) {
  const access = await requireTenantPermission("settings.sensitive.manage");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const body = await request.json().catch(() => null) as { connectionId?: unknown } | null;
  const connectionId = typeof body?.connectionId === "string" ? body.connectionId : "";
  if (!connectionId) return NextResponse.json({ error: "Choose an accounting connection to disconnect." }, { status: 400 });
  const { data } = await access.service.from("accounting_connections").select("*")
    .eq("id", connectionId).eq("business_id", access.businessId).maybeSingle();
  const connection = data as AccountingConnectionRecord | null;
  if (!connection) return NextResponse.json({ error: "Accounting connection not found." }, { status: 404 });

  let revokeError: string | null = null;
  if (connection.refresh_token_ciphertext) {
    try {
      await getAccountingAdapter(connection.provider).revoke(decryptAccountingSecret(connection.refresh_token_ciphertext));
    } catch {
      revokeError = "Provider revocation could not be confirmed. Local credentials were removed.";
    }
  }
  const now = new Date().toISOString();
  const { error } = await access.service.from("accounting_connections").update({
    status: "disconnected",
    access_token_ciphertext: null,
    refresh_token_ciphertext: null,
    token_expires_at: null,
    disconnected_at: now,
    last_error_code: revokeError ? "REVOCATION_UNCONFIRMED" : null,
    last_error_message: revokeError,
    updated_at: now,
  }).eq("id", connection.id).eq("business_id", access.businessId);
  if (error) return NextResponse.json({ error: "Unable to disconnect the accounting integration." }, { status: 500 });
  await access.service.from("integration_health").upsert({
    business_id: access.businessId, provider: connection.provider, status: "disconnected",
    last_checked_at: now, consecutive_failures: 0, error_code: revokeError ? "REVOCATION_UNCONFIRMED" : null,
    actionable_message: revokeError, metadata: {}, updated_at: now,
  }, { onConflict: "business_id,provider" });
  await appendSensitiveAudit({
    access, request, action: "accounting.connection_disconnected", entityType: "accounting_connection",
    entityId: connection.id, before: { provider: connection.provider, status: connection.status },
    after: { provider: connection.provider, status: "disconnected", provider_revocation_confirmed: !revokeError },
  });
  return NextResponse.json({ disconnected: true, warning: revokeError });
}
