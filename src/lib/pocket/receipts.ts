import { z } from "zod";

import { pocketPaymentMethods } from "./payments";

export const pocketReceiptSources = ["camera", "image", "pdf"] as const;

export const pocketReceiptReviewSchema = z.object({
  documentKind: z.enum([
    "online_bank_transfer_receipt", "transaction_screenshot", "bank_in_cash_deposit_receipt",
    "payment_receipt", "unknown_or_other",
  ]),
  documentKindReason: z.string().trim().max(500).nullable().optional(),
  amount: z.string().trim().min(1).max(40),
  amountCandidateId: z.string().trim().max(100).nullable().optional(),
  amountCorrectionReason: z.string().trim().max(500).nullable().optional(),
  paymentDate: z.string().date(),
  dateCandidateId: z.string().trim().max(100).nullable().optional(),
  dateCorrectionReason: z.string().trim().max(500).nullable().optional(),
  reference: z.string().trim().max(255).nullable().optional(),
  referenceCandidateId: z.string().trim().max(100).nullable().optional(),
  referenceCorrectionReason: z.string().trim().max(500).nullable().optional(),
  bank: z.string().trim().max(255).nullable().optional(),
  bankCandidateId: z.string().trim().max(100).nullable().optional(),
  bankCorrectionReason: z.string().trim().max(500).nullable().optional(),
  payerHint: z.string().trim().max(255).nullable().optional(),
  payerCandidateId: z.string().trim().max(100).nullable().optional(),
  payerCorrectionReason: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).strict();

export const pocketReceiptConfirmationSchema = z.object({
  debtId: z.string().uuid(),
  expectedOutstandingMinor: z.number().int().safe().nonnegative(),
  method: z.enum(pocketPaymentMethods),
  note: z.string().trim().max(1000).nullable().optional(),
  duplicateAcknowledged: z.boolean().default(false),
}).strict();

export function pocketConfidenceLabel(confidence: number | null | undefined) {
  if (confidence == null || confidence < 0.6) return "Could not read";
  if (confidence < 0.85) return "Please check";
  return "Looks clear";
}

const receiptErrors: Record<string, { status: number; code: string; message: string }> = {
  POCKET_RECEIPT_NOT_AUTHORISED: { status: 403, code: "FORBIDDEN", message: "You do not have permission to confirm this receipt." },
  POCKET_RECEIPT_NOT_FOUND: { status: 404, code: "RECEIPT_NOT_FOUND", message: "This receipt draft is unavailable." },
  POCKET_RECEIPT_EVIDENCE_NOT_READY: { status: 409, code: "EVIDENCE_NOT_READY", message: "Wait for the receipt security scan and extraction to finish." },
  POCKET_RECEIPT_REVIEW_REQUIRED: { status: 409, code: "REVIEW_REQUIRED", message: "Review and confirm the extracted receipt fields first." },
  POCKET_RECEIPT_REVIEW_STALE: { status: 409, code: "STALE_REVIEW", message: "The receipt was replaced or reprocessed. Review the latest version." },
  POCKET_RECEIPT_DUPLICATE_REVIEW_REQUIRED: { status: 409, code: "DUPLICATE_REVIEW_REQUIRED", message: "Review and acknowledge the possible duplicate before continuing." },
  POCKET_RECEIPT_KIND_UNSUPPORTED: { status: 422, code: "UNSUPPORTED_RECEIPT", message: "This document is not confirmed as a supported payment receipt." },
  POCKET_RECEIPT_DATE_REQUIRED: { status: 422, code: "PAYMENT_DATE_REQUIRED", message: "Confirm the payment date before continuing." },
};

export function pocketReceiptError(message?: string | null) {
  const match = Object.entries(receiptErrors).find(([token]) => message?.includes(token))?.[1];
  return match ?? { status: 500, code: "RECEIPT_CONFIRMATION_FAILED", message: "The reviewed receipt could not be confirmed." };
}
