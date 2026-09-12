import { NextResponse } from "next/server";

const databaseErrors: Record<string, { status: number; code: string; message: string }> = {
  P16_PERMISSION_DENIED: { status: 403, code: "FORBIDDEN", message: "Payment approval permission is required." },
  P16_INVALID_IMPORT: { status: 400, code: "INVALID_TRANSACTION_IMPORT", message: "The normalized transaction import is invalid." },
  P16_IMPORT_BATCH_SCOPE_MISMATCH: { status: 404, code: "IMPORT_BATCH_NOT_FOUND", message: "The import batch is unavailable in this business." },
  P16_DUPLICATE_SCOPE_MISMATCH: { status: 404, code: "DUPLICATE_TRANSACTION_NOT_FOUND", message: "The referenced duplicate transaction is unavailable." },
  P16_IDEMPOTENCY_CONFLICT: { status: 409, code: "IDEMPOTENCY_CONFLICT", message: "This idempotency key was already used for a different request." },
  P16_INVALID_MATCH_JOB: { status: 400, code: "INVALID_MATCH_JOB", message: "The payment matching job is invalid." },
  P16_TRANSACTION_NOT_FOUND: { status: 404, code: "TRANSACTION_NOT_FOUND", message: "The normalized transaction was not found." },
  P16_TRANSACTION_ALREADY_ALLOCATED: { status: 409, code: "TRANSACTION_ALREADY_ALLOCATED", message: "This transaction already has an approved allocation." },
  P16_CANDIDATE_SCOPE_MISMATCH: { status: 409, code: "CANDIDATE_SCOPE_MISMATCH", message: "A candidate no longer belongs to this business or case." },
  P16_CANDIDATE_NOT_FOUND: { status: 404, code: "CANDIDATE_NOT_FOUND", message: "The payment match candidate was not found." },
  P16_CANDIDATE_STALE: { status: 409, code: "CANDIDATE_STALE", message: "A newer matching job exists; review its current candidates instead." },
  P16_CANDIDATE_ALREADY_REVIEWED: { status: 409, code: "CANDIDATE_ALREADY_REVIEWED", message: "This candidate is no longer awaiting review." },
  P16_SPLIT_AUTHORIZATION_REQUIRED: { status: 422, code: "SPLIT_AUTHORIZATION_REQUIRED", message: "Explicit split authorization and at least two allocations are required." },
  P16_ALLOCATION_TOTAL_MISMATCH: { status: 422, code: "ALLOCATION_TOTAL_MISMATCH", message: "Split allocations must equal the normalized transaction amount." },
  P16_CASE_UNAVAILABLE: { status: 409, code: "CASE_UNAVAILABLE", message: "The candidate case is no longer eligible for this payment." },
  P16_EXISTING_PAYMENT_UNAVAILABLE: { status: 409, code: "EXISTING_PAYMENT_UNAVAILABLE", message: "The linked payment is already final or no longer matches the transaction." },
};

export function matchingJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

export function matchingError(code: string, message: string, status: number) {
  return matchingJson({ error: { code, message } }, status);
}

export function matchingDatabaseError(message: string | undefined, fallback: string) {
  const match = Object.entries(databaseErrors).find(([token]) => message?.includes(token));
  return match ? matchingError(match[1].code, match[1].message, match[1].status) : matchingError("PAYMENT_MATCHING_SERVICE_ERROR", fallback, 500);
}

export function matchingAccessError(access: { error?: string; status?: number }) {
  const status = access.status ?? 503;
  return matchingError(status === 401 ? "AUTHENTICATION_REQUIRED" : status === 403 ? "FORBIDDEN" : "PAYMENT_MATCHING_UNAVAILABLE",
    access.error ?? "Payment matching access is unavailable.", status);
}
