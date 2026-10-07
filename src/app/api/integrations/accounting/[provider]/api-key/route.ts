/**
 * POST /api/integrations/accounting/{bukku|autocount}/api-key
 *
 * Connects accounting software that uses API keys instead of OAuth:
 *  - bukku:     { subdomain, accessToken }
 *  - autocount: { accountBookId, keyId, apiKey }
 * Credentials are verified with a live read, then stored encrypted.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appendSensitiveAudit, requireTenantPermission } from "@/lib/auth/tenant-access";
import { encryptAccountingSecret } from "@/lib/accounting/crypto";
import { getAccountingAdapter } from "@/lib/accounting/providers";
import { apiKeyAccountingProviders } from "@/lib/accounting/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store" };
const NEVER_EXPIRES = "2099-12-31T00:00:00.000Z";

const bukkuSchema = z.object({
  subdomain: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,63}$/, "Enter your Bukku company subdomain, for example mycompany."),
  accessToken: z.string().trim().min(20, "Paste the full access token from Bukku.").max(4000),
});
const autoCountSchema = z.object({
  accountBookId: z.string().trim().regex(/^\d{1,12}$/, "Enter your AutoCount account book ID (a number)."),
  keyId: z.string().trim().min(4, "Paste the Key ID from AutoCount.").max(200),
  apiKey: z.string().trim().min(10, "Paste the API Key from AutoCount.").max(2000),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const access = await requireTenantPermission("settings.sensitive.manage");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status, headers });
  const provider = (await params).provider;
  if (!(apiKeyAccountingProviders as readonly string[]).includes(provider)) {
    return NextResponse.json({ error: "This provider connects through its own sign-in page." }, { status: 404, headers });
  }
  const body = await request.json().catch(() => null);

  let secret: string;
  let tenantHint: string;
  if (provider === "bukku") {
    const parsed = bukkuSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400, headers });
    secret = parsed.data.accessToken;
    tenantHint = parsed.data.subdomain;
  } else {
    const parsed = autoCountSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400, headers });
    secret = JSON.stringify({ keyId: parsed.data.keyId, apiKey: parsed.data.apiKey });
    tenantHint = parsed.data.accountBookId;
  }

  const adapter = getAccountingAdapter(provider as (typeof apiKeyAccountingProviders)[number]);
  let organization: Awaited<ReturnType<typeof adapter.getOrganization>>;
  try {
    organization = await adapter.getOrganization(secret, tenantHint);
  } catch {
    return NextResponse.json({ error: "We couldn't sign in with those details. Check them in your accounting software and try again." }, { status: 400, headers });
  }

  const now = new Date().toISOString();
  const ciphertext = encryptAccountingSecret(secret);
  const { data: connection, error } = await access.service.from("accounting_connections").upsert({
    business_id: access.businessId,
    provider,
    status: "connected",
    external_tenant_id: organization.externalTenantId,
    organization_name: organization.name,
    scopes: [],
    // API keys do not expire or refresh; the same encrypted key fills both columns.
    access_token_ciphertext: ciphertext,
    refresh_token_ciphertext: ciphertext,
    token_expires_at: NEVER_EXPIRES,
    disconnected_at: null,
    last_error_code: null,
    last_error_message: null,
    metadata: { country_code: organization.countryCode, base_currency: organization.baseCurrency, capabilities: adapter.capabilities, credential_mode: "api_key" },
    created_by: access.user.id,
    updated_at: now,
  }, { onConflict: "business_id,provider" }).select("id").single();
  if (error || !connection) return NextResponse.json({ error: "We couldn't save the connection. Please try again." }, { status: 500, headers });

  await access.service.from("integration_health").upsert({
    business_id: access.businessId, provider, status: "unknown", last_checked_at: now, consecutive_failures: 0, error_code: null,
    actionable_message: "Connected. Run a preview or sync before treating this integration as healthy.",
    metadata: { connectionId: String(connection.id) }, updated_at: now,
  }, { onConflict: "business_id,provider" });
  await appendSensitiveAudit({
    access, request, action: "accounting.connection_authorized", entityType: "accounting_connection",
    entityId: String(connection.id), after: { provider, organization: organization.name, credential_mode: "api_key", write_back: false },
  });
  return NextResponse.json({ connected: true, organizationName: organization.name }, { headers });
}
