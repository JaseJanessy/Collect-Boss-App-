import { NextRequest, NextResponse } from "next/server";

import { authorizePocketCapability, requirePocketBillingAccess } from "@/lib/billing/pocket-entitlements";
import { paymentOperationRequestHash } from "@/lib/payment-operations/validation";
import { pocketPaymentError } from "@/lib/pocket/payments";
import { pocketReceiptConfirmationSchema, pocketReceiptError } from "@/lib/pocket/receipts";
import { loadPocketReceiptWorkspace } from "@/lib/pocket/receipts-server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };
type Context = { params: Promise<{ intakeId: string }> };

export async function POST(request: NextRequest, context: Context) {
  const access = await requirePocketBillingAccess("payment.approve");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key || key.length < 8 || key.length > 96) return NextResponse.json({ error: "A valid retry key is required.", code: "IDEMPOTENCY_KEY_REQUIRED" }, { status: 400, headers });
  const parsed = pocketReceiptConfirmationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose the customer debt and payment method." }, { status: 400, headers });
  const [receiptAuthorization, paymentAuthorization] = await Promise.all([
    authorizePocketCapability({ access, capability: "pocket.receipt.process", operationKey: key }),
    authorizePocketCapability({ access, capability: "pocket.payment.record", operationKey: key }),
  ]);
  if ("error" in receiptAuthorization) return NextResponse.json({ error: receiptAuthorization.error, code: receiptAuthorization.code }, { status: receiptAuthorization.status, headers });
  if ("error" in paymentAuthorization) return NextResponse.json({ error: paymentAuthorization.error, code: paymentAuthorization.code }, { status: paymentAuthorization.status, headers });
  const { intakeId } = await context.params;
  try {
    const receipt = await loadPocketReceiptWorkspace(access, intakeId);
    if (!receipt) return NextResponse.json({ error: "Receipt draft not found." }, { status: 404, headers });
    if (receipt.payment) return NextResponse.json({ payment: receipt.payment, idempotentReplay: true }, { headers });
    if (receipt.duplicateWarnings.length && !parsed.data.duplicateAcknowledged) {
      return NextResponse.json({ error: "Review and acknowledge the possible duplicate before continuing.", code: "DUPLICATE_REVIEW_REQUIRED", warnings: receipt.duplicateWarnings }, { status: 409, headers });
    }
  } catch {
    return NextResponse.json({ error: "Receipt review is temporarily unavailable." }, { status: 503, headers });
  }
  const requestHash = paymentOperationRequestHash({ intakeId, ...parsed.data });
  const { data, error } = await access.service.rpc("pocket_confirm_receipt_payment", {
    p_business_id: access.businessId, p_actor_id: access.user.id, p_intake_id: intakeId,
    p_debt_id: parsed.data.debtId, p_expected_outstanding_minor: parsed.data.expectedOutstandingMinor,
    p_method: parsed.data.method, p_note: parsed.data.note || null, p_duplicate_acknowledged: parsed.data.duplicateAcknowledged,
    p_idempotency_key: key, p_request_hash: requestHash,
  });
  if (error || !data) {
    const receiptError = pocketReceiptError(error?.message);
    const mapped = receiptError.code === "RECEIPT_CONFIRMATION_FAILED" ? pocketPaymentError(error?.message) : receiptError;
    return NextResponse.json({ error: mapped.message, code: mapped.code }, { status: mapped.status, headers });
  }
  return NextResponse.json({ payment: data }, { status: 201, headers });
}
