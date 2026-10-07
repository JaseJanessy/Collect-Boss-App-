/**
 * POST /api/public/pay/[token]/checkout  { amount?: "150.00" }
 *
 * Starts a Stripe Checkout (FPX / card) on the creditor's own connected Stripe
 * account for the collectable balance, or a smaller part-payment. The amount
 * is always checked server-side against the live collectable balance.
 */
import { NextRequest, NextResponse } from "next/server";
import { enforcePublicRateLimit, publicRateLimitResponse } from "@/lib/api/public-rate-limit";
import { getAppUrl } from "@/lib/app-url";
import { parseCurrencyToMinor } from "@/lib/financial/money";
import { getPublicActionContext } from "@/lib/public-access/service";
import { connectConfigured, loadConnection, MIN_ONLINE_PAYMENT_MINOR } from "@/lib/stripe/connect";
import { getStripeServer } from "@/lib/stripe/server";
import { getServiceClient } from "@/lib/supabase/service-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function reply(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rateLimit = await enforcePublicRateLimit({ headers: request.headers, rawToken: token, action: "online-checkout", limit: 6, windowSeconds: 300 });
  if (!rateLimit.allowed) return publicRateLimitResponse(rateLimit);

  const stripe = getStripeServer();
  const service = await getServiceClient();
  if (!stripe || !service || !connectConfigured()) return reply({ error: "Online payment is not available. Please use bank transfer." }, 503);

  const context = await getPublicActionContext(token, "payment");
  if (context.state !== "valid") return reply({ error: "This payment link can't be used." }, context.state === "unavailable" ? 503 : 404);
  const { id: caseId, business_id: businessId, currency } = context.caseScope;

  let connection: Awaited<ReturnType<typeof loadConnection>>;
  try { connection = await loadConnection(service, businessId); } catch { return reply({ error: "Online payment is temporarily unavailable." }, 503); }
  if (!connection?.charges_enabled) return reply({ error: "Online payment is not available for this business. Please use bank transfer." }, 409);

  const [{ data: caseRow, error: caseError }, { data: recovery, error: recoveryError }] = await Promise.all([
    service.from("cases").select("status,archived_at,invoice_no,payment_lock_mode").eq("id", caseId).eq("business_id", businessId).maybeSingle(),
    service.from("case_recovery_amounts").select("collectable_minor").eq("case_id", caseId).maybeSingle(),
  ]);
  if (caseError || recoveryError) return reply({ error: "Online payment is temporarily unavailable." }, 503);
  const c = caseRow as { status: string; archived_at: string | null; invoice_no: string | null; payment_lock_mode: string } | null;
  if (!c || c.archived_at || ["closed", "paid"].includes(c.status) || c.payment_lock_mode === "manual") {
    return reply({ error: "This payment link can't be used." }, 404);
  }
  const collectableMinor = Number((recovery as { collectable_minor: number | string } | null)?.collectable_minor ?? 0);
  if (!Number.isSafeInteger(collectableMinor) || collectableMinor < MIN_ONLINE_PAYMENT_MINOR) {
    return reply({ error: "There is no balance to pay online right now." }, 409);
  }

  const body = await request.json().catch(() => ({})) as { amount?: unknown };
  let amountMinor = collectableMinor;
  if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
    try {
      amountMinor = Number(parseCurrencyToMinor(String(body.amount), currency));
    } catch {
      return reply({ error: "Enter an amount such as 150 or 150.00." }, 400);
    }
    if (amountMinor < MIN_ONLINE_PAYMENT_MINOR) return reply({ error: "The minimum online payment is RM2.00." }, 400);
    if (amountMinor > collectableMinor) return reply({ error: "That is more than the balance due." }, 400);
  }

  let appUrl: string;
  try { appUrl = getAppUrl(); } catch { return reply({ error: "Online payment is temporarily unavailable." }, 503); }
  const returnUrl = `${appUrl}/pay/${encodeURIComponent(token)}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        quantity: 1,
        price_data: {
          currency: currency.toLowerCase(),
          unit_amount: amountMinor,
          product_data: { name: c.invoice_no ? `Payment for invoice ${c.invoice_no}` : "Payment of outstanding balance" },
        },
      }],
      success_url: `${returnUrl}?online=success`,
      cancel_url: `${returnUrl}?online=cancelled`,
      metadata: { collectboss_case_id: caseId, collectboss_business_id: businessId },
      payment_intent_data: { metadata: { collectboss_case_id: caseId, collectboss_business_id: businessId } },
    }, {
      stripeAccount: connection.stripe_account_id,
      // Same token, amount and 5-minute window reuse one session instead of creating duplicates.
      idempotencyKey: `debtor-checkout:${caseId}:${amountMinor}:${Math.floor(Date.now() / 300_000)}`,
    });
    if (!session.url) throw new Error("no_url");
    const { error } = await service.from("online_payment_sessions").upsert({
      business_id: businessId, case_id: caseId, stripe_account_id: connection.stripe_account_id,
      checkout_session_id: session.id, amount_minor: amountMinor, currency: currency.toUpperCase(), status: "open",
    }, { onConflict: "checkout_session_id", ignoreDuplicates: true });
    if (error) throw new Error("session_save_failed");
    return reply({ url: session.url });
  } catch {
    console.error("[connect] debtor_checkout_failed", { caseId });
    return reply({ error: "We couldn't start online payment. Please try again or use bank transfer." }, 502);
  }
}
