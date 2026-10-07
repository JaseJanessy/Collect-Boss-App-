/**
 * GET  /api/payments/online — the business's online payment (Stripe Connect) status.
 * POST /api/payments/online — create or resume Stripe onboarding; returns a Stripe-hosted URL.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAppUrl } from "@/lib/app-url";
import { appendSensitiveAudit, requireTenantPermission } from "@/lib/auth/tenant-access";
import { connectConfigured, loadConnection, refreshConnection } from "@/lib/stripe/connect";
import { getStripeServer } from "@/lib/stripe/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store" };

function view(connection: Awaited<ReturnType<typeof loadConnection>>) {
  if (!connection) return { state: "not_connected" as const };
  if (connection.charges_enabled) return { state: "active" as const, payoutsEnabled: connection.payouts_enabled };
  return { state: connection.details_submitted ? "under_review" as const : "setup_incomplete" as const };
}

export async function GET() {
  const access = await requireTenantPermission("case.read");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status, headers });
  if (!connectConfigured()) return NextResponse.json({ available: false, state: "not_connected" }, { headers });
  try {
    let connection = await loadConnection(access.service, access.businessId);
    if (connection && !connection.charges_enabled) connection = await refreshConnection(access.service, connection);
    return NextResponse.json({ available: true, ...view(connection) }, { headers });
  } catch {
    return NextResponse.json({ error: "We couldn't check your online payments right now. Please try again." }, { status: 503, headers });
  }
}

export async function POST(request: NextRequest) {
  const access = await requireTenantPermission("receiving_accounts.manage");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status, headers });
  const stripe = getStripeServer();
  if (!stripe || !connectConfigured()) return NextResponse.json({ error: "Online payments are not available yet." }, { status: 503, headers });
  const requestKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(requestKey)) return NextResponse.json({ error: "A valid Idempotency-Key header is required." }, { status: 400, headers });

  let appUrl: string;
  try { appUrl = getAppUrl(); } catch { return NextResponse.json({ error: "Online payments are not available yet." }, { status: 503, headers }); }

  try {
    let connection = await loadConnection(access.service, access.businessId);
    if (!connection) {
      const { data: business } = await access.service.from("businesses").select("business_name,email").eq("id", access.businessId).maybeSingle();
      const row = business as { business_name: string | null; email: string | null } | null;
      const account = await stripe.accounts.create({
        type: "standard",
        country: "MY",
        email: row?.email ?? access.user.email ?? undefined,
        business_profile: { name: row?.business_name ?? undefined },
        metadata: { business_id: access.businessId },
      }, { idempotencyKey: `connect-account:${access.businessId}` });
      const { data, error } = await access.service.from("business_payment_connections").upsert({
        business_id: access.businessId, stripe_account_id: account.id, created_by: access.user.id,
        charges_enabled: Boolean(account.charges_enabled), payouts_enabled: Boolean(account.payouts_enabled),
        details_submitted: Boolean(account.details_submitted), disconnected_at: null, updated_at: new Date().toISOString(),
      }, { onConflict: "business_id" }).select("*").single();
      if (error || !data) throw new Error("connection_save_failed");
      connection = data as NonNullable<typeof connection>;
      await appendSensitiveAudit({
        access, request, action: "online_payments.stripe_connected", entityType: "business_payment_connection",
        entityId: access.businessId, after: { stripe_account_id: account.id },
      });
    }
    const link = await stripe.accountLinks.create({
      account: connection.stripe_account_id,
      type: "account_onboarding",
      refresh_url: `${appUrl}/settings?online_payments=retry#online-payments`,
      return_url: `${appUrl}/settings?online_payments=return#online-payments`,
    }, { idempotencyKey: `connect-link:${access.businessId}:${requestKey}` });
    return NextResponse.json({ url: link.url }, { headers });
  } catch {
    console.error("[connect] onboarding_failed", { businessId: access.businessId });
    return NextResponse.json({ error: "We couldn't open Stripe setup. Please try again." }, { status: 502, headers });
  }
}
