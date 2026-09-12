import { NextResponse } from "next/server";

const databaseErrors: Record<string, { status: number; code: string; message: string }> = {
  P8_MEMBERSHIP_REQUIRED: { status: 403, code: "MEMBERSHIP_REQUIRED", message: "An active business membership is required." },
  P8_PERMISSION_DENIED: { status: 403, code: "FORBIDDEN", message: "You do not have permission to manage document drafts." },
  P8_SUBMIT_PERMISSION_DENIED: { status: 403, code: "SUBMIT_FORBIDDEN", message: "You do not have permission to submit this document draft." },
  P8_INTAKE_NOT_FOUND: { status: 404, code: "INTAKE_NOT_FOUND", message: "Document draft not found." },
  P8_EVIDENCE_NOT_FOUND: { status: 404, code: "EVIDENCE_NOT_FOUND", message: "Evidence file not found." },
  P8_IDEMPOTENCY_CONFLICT: { status: 409, code: "IDEMPOTENCY_CONFLICT", message: "This idempotency key was already used for a different request." },
  P8_INVALID_STATUS_TRANSITION: { status: 409, code: "INVALID_STATUS_TRANSITION", message: "That document status transition is not allowed." },
  P8_USE_FINALISE: { status: 409, code: "INVALID_STATUS_TRANSITION", message: "Submission must use the validated finalise action." },
  P8_INTAKE_LOCKED: { status: 409, code: "INTAKE_LOCKED", message: "Submitted or cancelled drafts cannot be changed." },
  P8_SUBMITTED_INTAKE_IMMUTABLE: { status: 409, code: "INTAKE_LOCKED", message: "Submitted drafts cannot be cancelled." },
  P8_CONFIRMATION_NOT_ALLOWED: { status: 409, code: "CONFIRMATION_NOT_ALLOWED", message: "Upload evidence before confirming this draft." },
  P8_CONFIRMATION_REQUIRED: { status: 409, code: "CONFIRMATION_REQUIRED", message: "The latest evidence version must be confirmed before submission." },
  P8_EVIDENCE_REQUIRED: { status: 409, code: "EVIDENCE_REQUIRED", message: "At least one current original evidence file is required." },
  P8_EVIDENCE_SCAN_PENDING: { status: 423, code: "EVIDENCE_SCAN_PENDING", message: "Evidence must pass security scanning before submission." },
  P8_ORIGINAL_IMMUTABLE: { status: 409, code: "ORIGINAL_IMMUTABLE", message: "Original evidence cannot be modified; upload a replacement version instead." },
  P9_CURRENT_EVIDENCE_REQUIRED: { status: 409, code: "EVIDENCE_NOT_CURRENT", message: "Only the current PDF can be removed from this draft." },
  P11_EXTRACTION_NOT_FOUND: { status: 404, code: "EXTRACTION_NOT_FOUND", message: "Document extraction was not found." },
  P11_EXTRACTION_ALREADY_PROCESSING: { status: 409, code: "EXTRACTION_ALREADY_PROCESSING", message: "Document extraction is already processing." },
  P11_EXTRACTION_LEASE_MISMATCH: { status: 409, code: "EXTRACTION_LEASE_MISMATCH", message: "Document extraction is no longer available to this worker." },
  P11_EXTRACTION_SCOPE_MISMATCH: { status: 409, code: "EXTRACTION_SCOPE_MISMATCH", message: "Document extraction is unavailable for this draft." },
  P12_EXTRACTION_RATE_LIMITED: { status: 429, code: "EXTRACTION_RATE_LIMITED", message: "Too many extraction requests. Try again later." },
  P13_INVALID_REVIEW: { status: 400, code: "INVALID_REVIEW", message: "The document review payload is invalid." },
  P13_EXTRACTION_REQUIRED: { status: 409, code: "EXTRACTION_REQUIRED", message: "Review the current evidence extraction before continuing." },
  P13_REVIEW_INCOMPLETE: { status: 422, code: "REVIEW_INCOMPLETE", message: "Complete all mandatory human confirmations before continuing." },
  P13_INVALID_CANDIDATE: { status: 409, code: "INVALID_CANDIDATE", message: "The selected candidate no longer matches the current extraction." },
  P13_MANUAL_REASON_REQUIRED: { status: 422, code: "MANUAL_REASON_REQUIRED", message: "Explain why a manual value is required." },
  P14_INVALID_WORKFLOW_DRAFT: { status: 400, code: "INVALID_WORKFLOW_DRAFT", message: "Complete the required transaction details before saving." },
  P14_WORKFLOW_VERSION_CONFLICT: { status: 409, code: "WORKFLOW_VERSION_CONFLICT", message: "This draft changed on another device. Reload it before continuing." },
  P14_WORKFLOW_NOT_READY: { status: 409, code: "WORKFLOW_NOT_READY", message: "Review the complete transaction summary before submitting." },
  P14_CONFIRMATION_MISMATCH: { status: 409, code: "CONFIRMATION_MISMATCH", message: "The workflow amount or currency no longer matches the confirmed extraction." },
  P14_PROFILE_DECISION_REQUIRED: { status: 409, code: "PROFILE_DECISION_REQUIRED", message: "Choose Use Existing Profile or Create New Profile." },
  P14_NEW_PROFILE_INVALID: { status: 400, code: "NEW_PROFILE_INVALID", message: "Enter the required new-profile details." },
  P14_CUSTOMER_SCOPE_MISMATCH: { status: 404, code: "PROFILE_UNAVAILABLE", message: "The selected profile is unavailable in this business." },
  P14_ACCOUNT_SCOPE_MISMATCH: { status: 404, code: "ACCOUNT_UNAVAILABLE", message: "The selected account is unavailable for this profile and currency." },
  P14_OBLIGATION_SCOPE_MISMATCH: { status: 404, code: "OBLIGATION_UNAVAILABLE", message: "The selected obligation is unavailable for this profile and currency." },
  P14_CASE_OBLIGATION_SCOPE_MISMATCH: { status: 404, code: "CASE_OBLIGATION_UNAVAILABLE", message: "Choose a case linked to the selected obligation." },
  P14_DUPLICATE_REVIEW_REQUIRED: { status: 409, code: "DUPLICATE_REVIEW_REQUIRED", message: "Review the possible duplicate transaction before submitting." },
  P14_REQUIRED_DETAILS_MISSING: { status: 400, code: "REQUIRED_DETAILS_MISSING", message: "A due date and reference are required for this obligation." },
  P14_REFUND_PERMISSION_DENIED: { status: 403, code: "REFUND_FORBIDDEN", message: "Payment approval permission is required to record a refund." },
  P14_REFUND_ORIGINAL_MISMATCH: { status: 409, code: "REFUND_ORIGINAL_MISMATCH", message: "The original approved payment does not match this refund." },
  P14_CASE_NOT_JUSTIFIED: { status: 409, code: "CASE_NOT_JUSTIFIED", message: "A collection case requires an explicit choice and an overdue outstanding obligation." },
  P15_EXACT_DUPLICATE_BLOCKED: { status: 409, code: "EXACT_DUPLICATE_BLOCKED", message: "This evidence exactly matches an existing transaction and cannot be posted again." },
  P15_TRANSACTION_NATURE_MISMATCH: { status: 409, code: "TRANSACTION_NATURE_MISMATCH", message: "The selected route no longer matches the confirmed transaction nature." },
  P15_FINANCIAL_CONFIRMATION_MISMATCH: { status: 409, code: "FINANCIAL_CONFIRMATION_MISMATCH", message: "The confirmed evidence does not represent a financial movement." },
  P15_FINAL_SUBMIT_RATE_LIMITED: { status: 429, code: "FINAL_SUBMIT_RATE_LIMITED", message: "Too many final submissions. Try again later." },
};

export function apiJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

export function apiError(code: string, message: string, status: number) {
  return apiJson({ error: { code, message } }, status);
}

export function databaseApiError(message: string | undefined, fallbackMessage: string) {
  const matched = Object.entries(databaseErrors).find(([token]) => message?.includes(token));
  if (matched) return apiError(matched[1].code, matched[1].message, matched[1].status);
  return apiError("DOCUMENT_SERVICE_ERROR", fallbackMessage, 500);
}

export function authApiError(access: { error?: string; status?: number }) {
  const status = access.status ?? 503;
  const code = status === 401 ? "AUTHENTICATION_REQUIRED" : status === 403 ? "FORBIDDEN" : "DOCUMENT_SERVICE_UNAVAILABLE";
  return apiError(code, access.error ?? "Document access service is unavailable.", status);
}
