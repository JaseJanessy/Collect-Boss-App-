import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service-client";
import { accountingProviders, type AccountingProvider } from "@/lib/accounting/types";
import { enqueueIntegrationJob } from "@/lib/integrations/queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function verify(provider: AccountingProvider, raw: string, request: NextRequest) {
  const secretName = provider === "xero" ? "XERO_WEBHOOK_KEY" : "QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN";
  const secret = process.env[secretName]?.trim();
  if (!secret) return "not_configured" as const;
  const header = provider === "xero" ? request.headers.get("x-xero-signature") : request.headers.get("intuit-signature");
  if (!header) return "invalid" as const;
  const expected = createHmac("sha256", secret).update(raw, "utf8").digest("base64");
  return safeEqual(expected, header) ? "valid" as const : "invalid" as const;
}

interface QueuedWebhookEvent {
  provider: AccountingProvider;
  external_tenant_id: string;
  event_key: string;
  payload: Record<string, unknown>;
}

function eventRows(provider: AccountingProvider, raw: string, payload: Record<string, unknown>): QueuedWebhookEvent[] {
  const fallbackKey = createHash("sha256").update(`${provider}:${raw}`).digest("hex");
  if (provider === "xero") {
    const events = Array.isArray(payload.events) ? payload.events : [];
    return events.map((value, index) => {
      const event = value && typeof value === "object" ? value as Record<string, unknown> : {};
      const tenantId = typeof event.tenantId === "string" ? event.tenantId : "";
      const resourceId = typeof event.resourceId === "string" ? event.resourceId : "";
      const eventDate = typeof event.eventDateUtc === "string" ? event.eventDateUtc : "";
      return {
        provider, external_tenant_id: tenantId,
        event_key: `${tenantId}:${resourceId}:${eventDate || `${fallbackKey}:${index}`}`,
        payload: { resource_id: resourceId, event_type: String(event.eventType ?? "changed"), event_date: eventDate },
      };
    }).filter((row) => row.external_tenant_id);
  }
  const notifications = Array.isArray(payload.eventNotifications) ? payload.eventNotifications : [];
  return notifications.flatMap((value, notificationIndex) => {
    const notification = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const realmId = typeof notification.realmId === "string" ? notification.realmId : "";
    const changeEvent = notification.dataChangeEvent && typeof notification.dataChangeEvent === "object"
      ? notification.dataChangeEvent as Record<string, unknown> : {};
    const entities = Array.isArray(changeEvent.entities) ? changeEvent.entities : [];
    return entities.map((entityValue, entityIndex) => {
      const entity = entityValue && typeof entityValue === "object" ? entityValue as Record<string, unknown> : {};
      const keyParts = [realmId, entity.name, entity.id, entity.operation, entity.lastUpdated].map((item) => String(item ?? ""));
      return {
        provider, external_tenant_id: realmId,
        event_key: keyParts.some((part, index) => index > 0 && part) ? keyParts.join(":") : `${realmId}:${fallbackKey}:${notificationIndex}:${entityIndex}`,
        payload: {
          entity_name: String(entity.name ?? ""), entity_id: String(entity.id ?? ""),
          operation: String(entity.operation ?? ""), last_updated: String(entity.lastUpdated ?? ""),
        },
      };
    });
  }).filter((row) => row.external_tenant_id);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const rawProvider = (await params).provider;
  if (!accountingProviders.includes(rawProvider as AccountingProvider)) return new NextResponse(null, { status: 404 });
  // Only OAuth providers push webhooks; API-key providers are synced by polling.
  if (rawProvider !== "xero" && rawProvider !== "quickbooks") return new NextResponse(null, { status: 404 });
  const provider = rawProvider as AccountingProvider;
  const raw = await request.text();
  const verification = verify(provider, raw, request);
  if (verification === "not_configured") return NextResponse.json({ error: "Webhook verification is not configured." }, { status: 503 });
  if (verification !== "valid") return new NextResponse(null, { status: 401 });
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(raw) as Record<string, unknown>; } catch { return new NextResponse(null, { status: 400 }); }
  const rows = eventRows(provider, raw, payload);
  if (!rows.length) return new NextResponse(null, { status: 200 });
  const service = await getServiceClient();
  if (!service) return NextResponse.json({ error: "Webhook queue is unavailable." }, { status: 503 });
  const tenantIds = [...new Set(rows.map((row) => row.external_tenant_id))];
  const { data: connections, error: connectionError } = await service.from("accounting_connections")
    .select("id,business_id,external_tenant_id").eq("provider", provider).in("external_tenant_id", tenantIds)
    .in("status", ["connected", "error"]);
  if (connectionError) return NextResponse.json({ error: "Webhook queue is unavailable." }, { status: 503 });
  const connectionByTenant = new Map((connections ?? []).map((connection) => [String(connection.external_tenant_id), connection]));
  const durableRows = rows.map((row) => {
    const connection = connectionByTenant.get(row.external_tenant_id);
    return {
      ...row,
      business_id: connection?.business_id ?? null,
      connection_id: connection?.id ?? null,
      status: connection ? "pending" as const : "dead_letter" as const,
      last_error: connection ? null : "No active tenant-owned connection matches this provider organization.",
      dead_lettered_at: connection ? null : new Date().toISOString(),
    };
  });
  const { error } = await service.from("accounting_webhook_events").upsert(durableRows, { onConflict: "provider,event_key", ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: "Webhook queue is unavailable." }, { status: 503 });
  try {
    await Promise.all(durableRows.filter((row) => row.business_id && row.connection_id).map((row) => enqueueIntegrationJob({
      provider, jobType: "accounting_webhook", businessId: row.business_id,
      resourceId: String(row.connection_id), operationKey: row.event_key,
      payload: { connectionId: String(row.connection_id), webhookEventKey: row.event_key },
    })));
  } catch {
    return NextResponse.json({ error: "Webhook recovery operation could not be queued." }, { status: 503 });
  }
  // Provider callbacks are acknowledged after durable enqueue. Reconciliation
  // is intentionally asynchronous and does not claim real-time processing.
  return new NextResponse(null, { status: 200 });
}
