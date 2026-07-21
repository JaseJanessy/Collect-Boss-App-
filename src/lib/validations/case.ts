import { z } from "zod";

// ─── Status enum ──────────────────────────────────────────────────────────────

export const caseStatusSchema = z.enum([
  "action_needed",
  "payment_promise",
  "partial_paid",
  "paid",
  "overdue",
  "formal_demand_ready",
  "closed",
]);

export type CaseStatusValue = z.infer<typeof caseStatusSchema>;

export const STATUS_LABELS: Record<CaseStatusValue, string> = {
  action_needed:       "Action Needed",
  payment_promise:     "Payment Promise",
  partial_paid:        "Partial Paid",
  paid:                "Paid",
  overdue:             "Overdue",
  formal_demand_ready: "Formal Demand Ready",
  closed:              "Closed",
};

// ─── Create case ──────────────────────────────────────────────────────────────

export const createCaseSchema = z.object({
  debtor_type: z.enum(["individual", "business"]).default("individual"),

  debtor_name: z
    .string()
    .min(2, "Debtor name must be at least 2 characters")
    .max(150, "Name is too long"),

  debtor_phone: z
    .string()
    .max(30, "Phone number is too long")
    .optional()
    .or(z.literal("")),

  debtor_email: z
    .string()
    .max(150, "Email is too long")
    .optional()
    .or(z.literal("")),

  debtor_company: z
    .string()
    .max(150, "Company name is too long")
    .optional()
    .or(z.literal("")),

  debtor_reg_no: z
    .string()
    .max(80, "Registration number is too long")
    .optional()
    .or(z.literal("")),

  debtor_contact_name: z
    .string()
    .max(160, "Contact name is too long")
    .optional()
    .or(z.literal("")),

  existing_debtor_id: z.string().uuid().optional(),
  duplicate_acknowledged: z.boolean().optional().default(false),

  debtor_location: z
    .string()
    .max(200, "Location is too long")
    .optional()
    .or(z.literal("")),

  amount_owed: z
    .string()
    .min(1, "Amount is required")
    .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, "Amount must use at most two decimal places")
    .refine((v) => v !== "0" && v !== "0.0" && v !== "0.00", { message: "Amount must be greater than RM 0.00" }),

  due_date: z
    .string()
    .min(1, "Due date is required"),

  invoice_no: z
    .string()
    .max(50, "Invoice number is too long")
    .optional()
    .or(z.literal("")),

  payment_lock_mode: z
    .enum(["immediate", "approval", "manual"])
    .default("approval"),

  notes: z
    .string()
    .max(1000, "Notes are too long")
    .optional()
    .or(z.literal("")),
}).superRefine((value, context) => {
  if (value.debtor_type === "business" && !value.debtor_company?.trim()) {
    context.addIssue({
      code: "custom",
      path: ["debtor_company"],
      message: "Business debtors need a company name.",
    });
  }
});

export type CreateCaseInput = z.infer<typeof createCaseSchema>;

// ─── Update case status ───────────────────────────────────────────────────────

export const updateStatusSchema = z.object({
  status: caseStatusSchema,
});

export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;

// ─── Update next best action ──────────────────────────────────────────────────

export const updateNextActionSchema = z.object({
  next_best_action: z
    .string()
    .max(200, "Next action description is too long")
    .optional()
    .or(z.literal("")),
});

export type UpdateNextActionInput = z.infer<typeof updateNextActionSchema>;

export const updatePaymentLockModeSchema = z.object({
  payment_lock_mode: z.enum(["immediate", "approval", "manual"]),
});

export const casePatchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("status"),
    status: caseStatusSchema,
    reason: z.string().max(500).optional(),
    promise_due_date: z.string().date().optional(),
    expected_version: z.number().int().positive().optional(),
  }),
  z.object({
    action: z.literal("archive"),
    reason: z.string().max(500).optional(),
    expected_version: z.number().int().positive().optional(),
  }),
  z.object({
    action: z.literal("next_action"),
    next_best_action: z.string().max(200, "Next action description is too long").optional().or(z.literal("")),
  }),
  z.object({ action: z.literal("payment_lock_mode"), payment_lock_mode: z.enum(["immediate", "approval", "manual"]) }),
  z.object({
    action: z.literal("record_payment"),
    amount: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, "Amount must have at most two decimal places."),
  }),
]);

export type CasePatchInput = z.infer<typeof casePatchSchema>;

// ─── Record manual payment ────────────────────────────────────────────────────

export const recordPaymentAmountSchema = z.object({
  amount_paid_additional: z
    .string()
    .min(1, "Amount is required")
    .refine(
      (v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0,
      { message: "Payment amount must be greater than RM 0.00" }
    ),
  notes: z
    .string()
    .max(500, "Notes are too long")
    .optional()
    .or(z.literal("")),
});

export type RecordPaymentAmountInput = z.infer<typeof recordPaymentAmountSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a string amount like "1500.00" to a number safely */
export function parseAmount(str: string): number {
  return parseFloat(str) || 0;
}

/** Format number to RM string */
export function formatRMInput(amount: number): string {
  return amount.toFixed(2);
}
