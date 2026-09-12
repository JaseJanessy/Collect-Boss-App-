import { NextResponse } from "next/server";
import type { ZodError } from "zod";

const databaseErrors: Record<string, { status: number; code: string; message: string }> = {
  P17_PERMISSION_DENIED: { status: 403, code: "FORBIDDEN", message: "You do not have permission to perform this payment operation." },
  P17_APPROVAL_PERMISSION_DENIED: { status: 403, code: "APPROVAL_FORBIDDEN", message: "Owner or administrator approval is required." },
  P17_SELF_APPROVAL_FORBIDDEN: { status: 409, code: "SELF_APPROVAL_FORBIDDEN", message: "The requester cannot approve their own reallocation." },
  P17_RECEIPT_NOT_FOUND: { status: 404, code: "RECEIPT_NOT_FOUND", message: "Payment receipt not found." },
  P17_ALLOCATION_NOT_FOUND: { status: 404, code: "ALLOCATION_NOT_FOUND", message: "Payment allocation not found." },
  P17_CASE_NOT_FOUND: { status: 404, code: "CASE_NOT_FOUND", message: "The target case is unavailable." },
  P17_OBLIGATION_NOT_FOUND: { status: 404, code: "OBLIGATION_NOT_FOUND", message: "The target invoice or obligation is unavailable." },
  P17_APPROVAL_NOT_FOUND: { status: 404, code: "APPROVAL_NOT_FOUND", message: "Reallocation approval request not found." },
  P17_IDEMPOTENCY_CONFLICT: { status: 409, code: "IDEMPOTENCY_CONFLICT", message: "This idempotency key was already used for a different request." },
  P17_AVAILABLE_AMOUNT_EXCEEDED: { status: 409, code: "AVAILABLE_AMOUNT_EXCEEDED", message: "The allocation exceeds the receipt's available amount." },
  P17_ALLOCATION_ALREADY_REVERSED: { status: 409, code: "ALLOCATION_ALREADY_REVERSED", message: "This allocation has already been reversed." },
  P17_RECEIPT_REVERSED: { status: 409, code: "RECEIPT_REVERSED", message: "A reversed receipt cannot be allocated." },
  P17_RECEIPT_ALREADY_REVERSED: { status: 409, code: "RECEIPT_ALREADY_REVERSED", message: "This receipt has already been reversed." },
  P17_RECEIPT_REVERSAL_REQUIRES_UNALLOCATED_FUNDS: { status: 409, code: "RECEIPT_REVERSAL_REQUIRES_UNALLOCATED_FUNDS", message: "Reverse all allocations before reversing the receipt; refunded receipts cannot be reversed." },
  P17_REFUND_REQUIRES_UNALLOCATED_FUNDS: { status: 409, code: "REFUND_REQUIRES_UNALLOCATED_FUNDS", message: "Reverse allocations before refunding allocated funds." },
  P17_REALLOCATION_APPROVAL_REQUIRED: { status: 409, code: "REALLOCATION_APPROVAL_REQUIRED", message: "An approved reallocation request matching these allocations is required." },
  P17_EXCHANGE_RATE_REQUIRED: { status: 422, code: "EXCHANGE_RATE_REQUIRED", message: "A matching explicit exchange-rate record is required." },
  P17_SILENT_CURRENCY_CONVERSION: { status: 422, code: "SILENT_CURRENCY_CONVERSION_BLOCKED", message: "Same-currency allocations must use the same minor-unit amount without an exchange rate." },
  P17_UNBALANCED_JOURNAL: { status: 500, code: "UNBALANCED_JOURNAL", message: "The financial journal did not balance; no changes were posted." },
};

export function paymentApiJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}

export function paymentApiError(code: string, message: string, status: number, details?: unknown) {
  return paymentApiJson({ error: { code, message, ...(details ? { details } : {}) } }, status);
}

export function paymentValidationError(error: ZodError) {
  return paymentApiError("VALIDATION_FAILED", "The payment operation payload is invalid.", 400, error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
}

export function paymentDatabaseError(message: string | undefined) {
  const matched = Object.entries(databaseErrors).find(([token]) => message?.includes(token));
  if (matched) return paymentApiError(matched[1].code, matched[1].message, matched[1].status);
  return paymentApiError("PAYMENT_OPERATION_FAILED", "The payment operation could not be completed.", 500);
}

export function paymentAuthError(access: { error?: string; status?: number }) {
  const status = access.status ?? 503;
  return paymentApiError(status === 401 ? "AUTHENTICATION_REQUIRED" : status === 403 ? "FORBIDDEN" : "PAYMENT_SERVICE_UNAVAILABLE", access.error ?? "Payment access is unavailable.", status);
}

export function idempotencyKey(request: Request) {
  const key = request.headers.get("idempotency-key")?.trim();
  return key && key.length <= 200 ? key : null;
}
