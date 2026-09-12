import { NextRequest } from "next/server";
import { requireTenantPermission } from "@/lib/auth/tenant-access";
import { idempotencyKey, paymentApiError, paymentApiJson, paymentAuthError, paymentDatabaseError, paymentValidationError } from "@/lib/payment-operations/api";
import { paymentOperationRequestHash, reversalInputSchema } from "@/lib/payment-operations/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ receiptId: string }> }) {
  const access = await requireTenantPermission("payment.approve");
  if ("error" in access) return paymentAuthError(access);
  const key = idempotencyKey(request);
  if (!key) return paymentApiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 400);
  const parsed = reversalInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return paymentValidationError(parsed.error);
  const { receiptId } = await params;
  const hash = paymentOperationRequestHash({ receiptId, ...parsed.data });
  const { data, error } = await access.service.rpc("payment_operation_reverse_receipt", {
    p_business_id: access.businessId, p_receipt_id: receiptId, p_actor_id: access.user.id,
    p_reason: parsed.data.reason, p_idempotency_key: key, p_request_hash: hash,
  });
  if (error) return paymentDatabaseError(error.message);
  return paymentApiJson({ operation: data }, 201);
}
