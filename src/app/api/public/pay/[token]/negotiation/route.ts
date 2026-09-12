import { NextRequest, NextResponse } from "next/server";
import { enforcePublicRateLimit, publicRateLimitResponse } from "@/lib/api/public-rate-limit";
import { getPublicActionContext, resolvePublicPayment } from "@/lib/public-access/service";
import { getServiceClient } from "@/lib/supabase/service-client";
import { parseCurrencyToMinor } from "@/lib/financial/money";
import type { PaymentNegotiationOption, PaymentNegotiationRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const options = new Set<PaymentNegotiationOption>(["promise_to_pay", "installment_plan", "payment_difficulty"]);

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rateLimit = await enforcePublicRateLimit({ headers: request.headers, rawToken: token, action: "negotiation", limit: 8, windowSeconds: 300 });
  if (!rateLimit.allowed) return publicRateLimitResponse(rateLimit);
  const [access, payment] = await Promise.all([
    getPublicActionContext(token, "payment"),
    resolvePublicPayment(token),
  ]);
  if (access.state !== "valid" || payment.state !== "valid") return json({ error: "Payment link is unavailable." }, 404);
  if (payment.data.accessRequired || !payment.data.receivingAccount) {
    return json({ error: "Unlock the secure payment details before requesting payment time." }, 409);
  }
  if (payment.data.dispute.active) {
    return json({ error: "Resolve the amount issue before requesting payment time." }, 409);
  }
  if (payment.data.paymentPlanProgress) {
    return json({ error: "A payment plan is already active." }, 409);
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.optionType !== "string" || !options.has(body.optionType as PaymentNegotiationOption)
    || typeof body.amountNow !== "string" || typeof body.installmentAmount !== "string"
    || (body.frequency !== "weekly" && body.frequency !== "monthly")
    || typeof body.startDate !== "string" || !datePattern.test(body.startDate)
    || typeof body.idempotencyKey !== "string" || !uuidPattern.test(body.idempotencyKey)) {
    return json({ error: "Enter valid payment arrangement details." }, 400);
  }
  let amountNowMinor: bigint;
  let installmentAmountMinor: bigint;
  try {
    amountNowMinor = body.amountNow.trim() ? parseCurrencyToMinor(body.amountNow, access.caseScope.currency) : 0n;
    installmentAmountMinor = parseCurrencyToMinor(body.installmentAmount, access.caseScope.currency);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Enter valid amounts." }, 400);
  }
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
  const service = await getServiceClient();
  if (!service) return json({ error: "Payment arrangement service is unavailable." }, 503);
  const { data, error } = await service.rpc("payment_negotiation_submit", {
    p_token_id: access.token.id,
    p_option_type: body.optionType as PaymentNegotiationOption,
    p_amount_now_minor: amountNowMinor.toString(),
    p_installment_amount_minor: installmentAmountMinor.toString(),
    p_frequency: body.frequency,
    p_start_date: body.startDate,
    p_reason: reason || null,
    p_note: note || null,
    p_idempotency_key: body.idempotencyKey,
  });
  if (error || !data) return json({ error: error?.message ?? "Unable to submit payment arrangement." }, 409);
  return json({ negotiation: data as PaymentNegotiationRow }, 201);
}
