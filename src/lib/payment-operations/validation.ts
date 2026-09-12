import { createHash } from "node:crypto";
import { z } from "zod";

const currency = z.string().trim().regex(/^[A-Za-z]{3}$/u).transform((value) => value.toUpperCase());
const optionalText = (maximum: number) => z.string().trim().max(maximum).nullable().optional();

export const receiptInputSchema = z.object({
  receiptKind: z.enum(["payment", "credit"]).default("payment"),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency,
  receivedAt: z.string().datetime({ offset: true }),
  sourceType: z.enum(["bank_statement", "accounting", "manual", "payment_proof", "credit_note"]),
  sourceSystem: z.string().trim().min(1).max(80),
  sourceRecordId: z.string().trim().min(1).max(255),
  normalizedTransactionId: z.string().uuid().nullable().optional(),
  reference: optionalText(255),
  payerName: optionalText(255),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
}).strict();

export const allocationItemSchema = z.object({
  caseId: z.string().trim().min(1).max(80),
  obligationId: z.string().uuid().nullable().optional(),
  receiptAmountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  targetAmountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  exchangeRateId: z.string().uuid().nullable().optional(),
}).strict();

export const allocationInputSchema = z.object({
  allocations: z.array(allocationItemSchema).min(1).max(20),
  reason: optionalText(1000),
  approvalRequestId: z.string().uuid().nullable().optional(),
}).strict();

export const reversalInputSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
}).strict();

export const refundInputSchema = z.object({
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  reason: z.string().trim().min(3).max(1000),
  externalReference: optionalText(255),
}).strict();

export const exchangeRateInputSchema = z.object({
  sourceCurrency: currency,
  targetCurrency: currency,
  numerator: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  denominator: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  effectiveAt: z.string().datetime({ offset: true }),
  provider: z.string().trim().min(1).max(80),
  providerRecordId: z.string().trim().min(1).max(255),
  evidence: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
}).strict().refine((value) => value.sourceCurrency !== value.targetCurrency, { message: "Exchange-rate currencies must differ." });

export const approvalRequestInputSchema = z.object({
  receiptId: z.string().uuid(),
  allocations: z.array(allocationItemSchema).min(1).max(20),
  reason: z.string().trim().min(3).max(1000),
}).strict();

export const approvalDecisionInputSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(3).max(1000),
}).strict();

export function paymentOperationRequestHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
