import { createHash } from "node:crypto";
import { z } from "zod";

const nullableText = (maximum: number) => z.string().trim().max(maximum).nullable().optional();

export const normalizedTransactionSourceTypes = [
  "bank_statement", "accounting", "manual", "payment_proof",
] as const;

export const normalizedTransactionInputSchema = z.object({
  sourceType: z.enum(normalizedTransactionSourceTypes),
  sourceSystem: z.string().trim().min(1).max(80),
  sourceRecordId: z.string().trim().min(1).max(255),
  sourceBatchKey: nullableText(255),
  importBatchId: z.string().uuid().nullable().optional(),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/u).transform((value) => value.toUpperCase()),
  occurredAt: z.string().datetime({ offset: true }).nullable().optional(),
  reference: nullableText(255),
  invoiceNumber: nullableText(255),
  partyName: nullableText(255),
  accountReference: nullableText(255),
  phone: nullableText(50),
  phoneMatchPermitted: z.boolean().default(false),
  duplicateOfTransactionId: z.string().uuid().nullable().optional(),
  duplicateSignals: z.array(z.object({ code: z.string().trim().min(1).max(80), detail: z.string().trim().min(1).max(500) }).strict()).max(20).default([]),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
}).strict();

export const normalizedTransactionBatchSchema = z.object({
  transactions: z.array(normalizedTransactionInputSchema).min(1).max(500),
}).strict();

export const matchingSettingsSchema = z.object({
  highConfidence: z.number().int().min(70).max(95),
  ambiguous: z.number().int().min(30).max(69),
  dateWindowDays: z.number().int().min(1).max(30),
  maximumCandidates: z.number().int().min(3).max(20),
}).strict().refine((value) => value.highConfidence >= value.ambiguous + 10, {
  message: "High-confidence threshold must be at least 10 points above ambiguous.",
  path: ["highConfidence"],
});

export const reviewDecisionSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("approve"),
    candidateId: z.string().uuid(),
    note: nullableText(1000),
    splitAuthorization: z.literal(false).default(false),
  }).strict(),
  z.object({
    decision: z.literal("approve_split"),
    candidateId: z.string().uuid(),
    note: z.string().trim().min(3).max(1000),
    splitAuthorization: z.literal(true),
    allocations: z.array(z.object({
      candidateId: z.string().uuid(),
      amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    }).strict()).min(2).max(20),
  }).strict(),
  z.object({
    decision: z.enum(["reject", "defer"]),
    candidateId: z.string().uuid(),
    note: z.string().trim().min(3).max(1000),
  }).strict(),
]);

export function requestHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function transactionFingerprint(input: z.infer<typeof normalizedTransactionInputSchema>) {
  return requestHash({
    sourceType: input.sourceType,
    sourceSystem: input.sourceSystem,
    sourceRecordId: input.sourceRecordId,
    amountMinor: input.amountMinor,
    currency: input.currency,
    occurredAt: input.occurredAt ?? null,
    reference: input.reference?.normalize("NFKC").trim().toUpperCase() ?? null,
  });
}

