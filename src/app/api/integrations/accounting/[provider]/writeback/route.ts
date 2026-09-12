import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appendSensitiveAudit, requireTenantPermission } from "@/lib/auth/tenant-access";
import { accountingProviders, type AccountingProvider } from "@/lib/accounting/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const inputSchema = z.object({ cashAccountId: z.string().trim().min(1).max(255) }).strict();

export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const access = await requireTenantPermission("settings.sensitive.manage");
  if ("error" in access) return NextResponse.json({ error: { code: "FORBIDDEN", message: access.error } }, { status: access.status });
  const rawProvider = (await params).provider;
  if (!accountingProviders.includes(rawProvider as AccountingProvider)) return NextResponse.json({ error: { code: "PROVIDER_NOT_FOUND", message: "Unsupported accounting provider." } }, { status: 404 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_FAILED", message: "Choose the provider cash or clearing account used for collected payments." } }, { status: 400 });
  const { data: connection } = await access.service.from("accounting_connections").select("id,metadata").eq("business_id", access.businessId).eq("provider", rawProvider).maybeSingle();
  if (!connection) return NextResponse.json({ error: { code: "CONNECTION_NOT_FOUND", message: "Connect this accounting provider before enabling payment write-back." } }, { status: 404 });
  const metadata = connection.metadata && typeof connection.metadata === "object" && !Array.isArray(connection.metadata) ? connection.metadata : {};
  const { error } = await access.service.from("accounting_connections").update({
    metadata: { ...metadata, paymentWriteback: { cashAccountId: parsed.data.cashAccountId } }, updated_at: new Date().toISOString(),
  }).eq("id", connection.id).eq("business_id", access.businessId);
  if (error) return NextResponse.json({ error: { code: "WRITEBACK_CONFIGURATION_FAILED", message: "Payment write-back could not be configured." } }, { status: 500 });
  await appendSensitiveAudit({ access, request, action: "accounting.payment_writeback_configured", entityType: "accounting_connection", entityId: String(connection.id), metadata: { provider: rawProvider } });
  return NextResponse.json({ configured: true, provider: rawProvider }, { headers: { "Cache-Control": "private, no-store" } });
}
