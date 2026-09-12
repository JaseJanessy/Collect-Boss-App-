import { NextRequest, NextResponse } from "next/server";
import { appendSensitiveAudit, requireTenantPermission } from "@/lib/auth/tenant-access";
import { digestAccountingValue, encryptAccountingSecret } from "@/lib/accounting/crypto";
import { getAccountingAdapter } from "@/lib/accounting/providers";
import { accountingProviders, type AccountingProvider } from "@/lib/accounting/types";
import { APP_URL, isAppUrlConfigured } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function settingsRedirect(provider: string, status: "connected" | "error", message?: string) {
  const url = new URL("/settings", APP_URL || "http://localhost:3000");
  url.searchParams.set("accounting", status);
  url.searchParams.set("provider", provider);
  if (message) url.searchParams.set("message", message.slice(0, 200));
  url.hash = "integrations";
  return NextResponse.redirect(url);
}

function providerValue(value: string): AccountingProvider | null {
  return accountingProviders.includes(value as AccountingProvider) ? value as AccountingProvider : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const provider = providerValue((await params).provider);
  if (!provider || !isAppUrlConfigured) return NextResponse.json({ error: "Accounting callback is unavailable." }, { status: 404 });
  const access = await requireTenantPermission("settings.sensitive.manage");
  if ("error" in access) return settingsRedirect(provider, "error", access.error);
  const code = request.nextUrl.searchParams.get("code")?.trim() ?? "";
  const state = request.nextUrl.searchParams.get("state")?.trim() ?? "";
  const realmId = request.nextUrl.searchParams.get("realmId")?.trim() ?? null;
  const providerError = request.nextUrl.searchParams.get("error");
  if (providerError || !code || !state) return settingsRedirect(provider, "error", "Authorization was cancelled or incomplete.");

  const stateHash = digestAccountingValue(state);
  const { data: savedState } = await access.service.from("accounting_oauth_states").select("id")
    .eq("business_id", access.businessId).eq("provider", provider).eq("state_hash", stateHash)
    .is("consumed_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (!savedState) return settingsRedirect(provider, "error", "Authorization state expired. Start the connection again.");
  const { data: consumed } = await access.service.from("accounting_oauth_states").update({ consumed_at: new Date().toISOString() })
    .eq("id", savedState.id).is("consumed_at", null).select("id").maybeSingle();
  if (!consumed) return settingsRedirect(provider, "error", "Authorization state was already used.");

  const adapter = getAccountingAdapter(provider);
  let issuedRefreshToken: string | null = null;
  let credentialsStored = false;
  try {
    const redirectUri = `${APP_URL}/api/integrations/accounting/${provider}/callback`;
    const tokens = await adapter.exchangeAuthorizationCode({ code, redirectUri });
    issuedRefreshToken = tokens.refreshToken;
    const missingScopes = adapter.requiredScopes.filter((scope) => !tokens.scopes.includes(scope));
    if (missingScopes.length) throw new Error("The provider did not grant the required accounting permissions. Reconnect and approve the requested access.");
    const organization = await adapter.getOrganization(tokens.accessToken, realmId);
    const { data: existingConnection } = await access.service.from("accounting_connections")
      .select("id,external_tenant_id").eq("business_id", access.businessId).eq("provider", provider).maybeSingle();
    if (existingConnection?.external_tenant_id && existingConnection.external_tenant_id !== organization.externalTenantId) {
      throw new Error("This provider is already mapped to a different organization. Existing mappings were preserved; contact support before changing organizations.");
    }
    const now = new Date().toISOString();
    const { data: connection, error } = await access.service.from("accounting_connections").upsert({
      business_id: access.businessId,
      provider,
      status: "connected",
      external_tenant_id: organization.externalTenantId,
      organization_name: organization.name,
      scopes: tokens.scopes,
      access_token_ciphertext: encryptAccountingSecret(tokens.accessToken),
      refresh_token_ciphertext: encryptAccountingSecret(tokens.refreshToken),
      token_expires_at: tokens.expiresAt,
      disconnected_at: null,
      last_error_code: null,
      last_error_message: null,
      metadata: { country_code: organization.countryCode, base_currency: organization.baseCurrency, capabilities: adapter.capabilities },
      created_by: access.user.id,
      updated_at: now,
    }, { onConflict: "business_id,provider" }).select("id").single();
    if (error || !connection) throw new Error("The authorized organization could not be stored.");
    credentialsStored = true;
    await access.service.from("integration_health").upsert({
      business_id: access.businessId, provider, status: "unknown", last_checked_at: now,
      consecutive_failures: 0, error_code: null,
      actionable_message: "Authorization succeeded. Run a preview or sync before treating this integration as healthy.",
      metadata: { connectionId: String(connection.id) }, updated_at: now,
    }, { onConflict: "business_id,provider" });
    await appendSensitiveAudit({
      access, request, action: "accounting.connection_authorized", entityType: "accounting_connection",
      entityId: String(connection.id), after: { provider, organization: organization.name, scopes: tokens.scopes, write_back: false },
    });
    return settingsRedirect(provider, "connected");
  } catch (error) {
    if (issuedRefreshToken && !credentialsStored) {
      await adapter.revoke(issuedRefreshToken).catch(() => undefined);
    }
    return settingsRedirect(provider, "error", error instanceof Error ? error.message : "Accounting authorization failed.");
  }
}
