import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireTenantPermission } from "@/lib/auth/tenant-access";
import { digestAccountingValue } from "@/lib/accounting/crypto";
import { getAccountingAdapter } from "@/lib/accounting/providers";
import { accountingProviders, type AccountingProvider } from "@/lib/accounting/types";
import { APP_URL, isAppUrlConfigured } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function providerValue(value: string): AccountingProvider | null {
  return accountingProviders.includes(value as AccountingProvider) ? value as AccountingProvider : null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const access = await requireTenantPermission("settings.sensitive.manage");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const provider = providerValue((await params).provider);
  if (!provider) return NextResponse.json({ error: "Unsupported accounting provider." }, { status: 404 });
  if (!isAppUrlConfigured) return NextResponse.json({ error: "Accounting OAuth is unavailable until NEXT_PUBLIC_APP_URL is configured." }, { status: 503 });

  const state = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const { error } = await access.service.from("accounting_oauth_states").insert({
    business_id: access.businessId,
    provider,
    state_hash: digestAccountingValue(state),
    created_by: access.user.id,
    expires_at: expiresAt,
  });
  if (error) return NextResponse.json({ error: "Unable to start the accounting connection." }, { status: 500 });
  const redirectUri = `${APP_URL}/api/integrations/accounting/${provider}/callback`;
  try {
    return NextResponse.redirect(getAccountingAdapter(provider).getAuthorizationUrl({ state, redirectUri }));
  } catch (configurationError) {
    return NextResponse.json({ error: configurationError instanceof Error ? configurationError.message : "Accounting provider is not configured." }, { status: 503 });
  }
}
