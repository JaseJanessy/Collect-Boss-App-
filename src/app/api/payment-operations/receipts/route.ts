import { NextRequest } from "next/server";
import { requireTenantPermission } from "@/lib/auth/tenant-access";
import { idempotencyKey, paymentApiError, paymentApiJson, paymentAuthError, paymentDatabaseError, paymentValidationError } from "@/lib/payment-operations/api";
import { paymentOperationRequestHash, receiptInputSchema } from "@/lib/payment-operations/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const access = await requireTenantPermission("report.read");
  if ("error" in access) return paymentAuthError(access);
  const limit = Math.min(200, Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 50));
  const state = request.nextUrl.searchParams.get("state");
  let query = access.service.from("payment_receipt_positions").select("*").eq("business_id", access.businessId).order("received_at", { ascending: false }).limit(limit);
  if (state) query = query.eq("state", state);
  const { data, error } = await query;
  if (error) return paymentApiError("RECEIPTS_UNAVAILABLE", "Payment receipts could not be loaded.", 500);
  return paymentApiJson({ receipts: data ?? [] });
}

export async function POST(request: NextRequest) {
  const access = await requireTenantPermission("payment.approve");
  if ("error" in access) return paymentAuthError(access);
  const key = idempotencyKey(request);
  if (!key) return paymentApiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 400);
  const parsed = receiptInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return paymentValidationError(parsed.error);
  const hash = paymentOperationRequestHash(parsed.data);
  const { data, error } = await access.service.rpc("payment_operation_record_receipt", {
    p_business_id: access.businessId, p_actor_id: access.user.id, p_receipt_kind: parsed.data.receiptKind,
    p_amount_minor: parsed.data.amountMinor, p_currency: parsed.data.currency, p_received_at: parsed.data.receivedAt,
    p_source_type: parsed.data.sourceType, p_source_system: parsed.data.sourceSystem, p_source_record_id: parsed.data.sourceRecordId,
    p_normalized_transaction_id: parsed.data.normalizedTransactionId ?? null, p_reference: parsed.data.reference ?? null,
    p_payer_name: parsed.data.payerName ?? null, p_metadata: parsed.data.metadata, p_idempotency_key: key, p_request_hash: hash,
  });
  if (error) return paymentDatabaseError(error.message);
  return paymentApiJson({ operation: data }, 201);
}
