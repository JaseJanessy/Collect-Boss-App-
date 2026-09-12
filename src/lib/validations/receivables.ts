import { z } from "zod";
import { parseCurrencyToMinor } from "@/lib/financial/money";

export const customerAccountTypeSchema = z.enum([
  "general", "corporate", "supplier", "rental", "vehicle",
  "property", "project", "catering_event", "future",
]);
export const customerAccountModeSchema = z.enum(["one_off", "ongoing"]);

export const obligationTypeSchema = z.enum([
  "invoice", "general_obligation", "rent", "vehicle", "property",
  "project", "supplier", "catering_event", "other",
]);

export const recoveryCaseScopeSchema = z.enum([
  "standalone", "single_obligation", "multiple_obligations", "account_balance",
]);

const metadataSchema = z.record(z.string(), z.json()).default({});
const optionalText = (maximum: number) =>
  z.string().trim().max(maximum).optional().nullable().transform((value) => value || null);
const moneySchema = z.string().max(24).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const signedMoneySchema = z.string().max(25).regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);

export const customerAccountWriteSchema = z.object({
  account_type: customerAccountTypeSchema.default("general"),
  account_mode: customerAccountModeSchema.default("one_off"),
  account_number: optionalText(120),
  display_name: z.string().trim().min(1).max(180),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default("MYR"),
  credit_limit: z.union([moneySchema, z.literal("")]).default("")
    .refine((value) => value === "" || Number(value) > 0, "Credit limit must be positive.")
    .transform((value) => value || null),
  credit_warning_threshold_percent: z.number().min(1).max(100).default(80),
  metadata: metadataSchema,
  custom_fields: metadataSchema,
}).superRefine((value, context) => {
  if (!value.credit_limit) return;
  try { parseCurrencyToMinor(value.credit_limit, value.currency); } catch (error) {
    context.addIssue({ code: "custom", path: ["credit_limit"], message: error instanceof Error ? error.message : "Invalid credit limit." });
  }
});
export const customerAccountUpdateSchema = customerAccountWriteSchema.extend({
  account_id: z.string().uuid(),
});

export const obligationWriteSchema = z.object({
  account_id: z.string().uuid().optional().nullable(),
  obligation_type: obligationTypeSchema.default("invoice"),
  reference: z.string().trim().min(1).max(160),
  purchase_order_reference: optionalText(160),
  issue_date: z.string().date().optional().nullable(),
  due_date: z.string().date(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default("MYR"),
  original_amount: moneySchema.refine((value) => Number(value) > 0, "Original amount must be positive."),
  adjustments: signedMoneySchema.default("0"),
  paid_amount: moneySchema.default("0"),
  metadata: metadataSchema,
  custom_fields: metadataSchema,
}).superRefine((value, context) => {
  let original = 0n;
  let adjustments = 0n;
  let paid = 0n;
  try {
    original = parseCurrencyToMinor(value.original_amount, value.currency);
    adjustments = parseCurrencyToMinor(value.adjustments, value.currency, { allowZero: true, allowNegative: true });
    paid = parseCurrencyToMinor(value.paid_amount, value.currency, { allowZero: true });
  } catch (error) {
    context.addIssue({ code: "custom", path: ["original_amount"], message: error instanceof Error ? error.message : "Invalid amount." });
    return;
  }
  if (value.issue_date && value.due_date < value.issue_date) {
    context.addIssue({ code: "custom", path: ["due_date"], message: "Due date cannot precede issue date." });
  }
  const contractual = original + adjustments;
  if (contractual < 0n) {
    context.addIssue({ code: "custom", path: ["adjustments"], message: "Adjustments cannot reduce the obligation below zero." });
  }
  if (paid > contractual) {
    context.addIssue({ code: "custom", path: ["paid_amount"], message: "Paid amount cannot exceed the obligation total." });
  }
});

export const caseReceivableScopeSchema = z.object({
  scope: recoveryCaseScopeSchema,
  account_id: z.string().uuid().optional().nullable(),
  obligation_ids: z.array(z.string().uuid()).max(100).default([]),
});

export const receivableChaseSchema = z.object({
  target: z.enum(["invoice", "account"]),
  account_id: z.string().uuid(),
  obligation_id: z.string().uuid().optional(),
  payment_lock_mode: z.enum(["immediate", "approval", "manual"]).default("approval"),
}).superRefine((value, context) => {
  if (value.target === "invoice" && !value.obligation_id) {
    context.addIssue({
      code: "custom",
      path: ["obligation_id"],
      message: "Select an invoice to chase.",
    });
  }
  if (value.target === "account" && value.obligation_id) {
    context.addIssue({
      code: "custom",
      path: ["obligation_id"],
      message: "Account-balance chasing selects all open invoices automatically.",
    });
  }
});
