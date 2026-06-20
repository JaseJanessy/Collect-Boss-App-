import { z } from "zod";

// ─── Status enum ──────────────────────────────────────────────────────────────

export const caseStatusSchema = z.enum([
  "action_needed",
  "payment_promise",
  "partial_paid",
  "paid",
  "overdue",
  "formal_demand_ready",
]);

export type CaseStatusValue = z.infer<typeof caseStatusSchema>;

export const STATUS_LABELS: Record<CaseStatusValue, string> = {
  action_needed:       "Action Needed",
  payment_promise:     "Payment Promise",
  partial_paid:        "Partial Paid",
  paid:                "Paid",
  overdue:             "Overdue",
  formal_demand_ready: "Formal Demand Ready",
};

// ─── Create case ──────────────────────────────────────────────────────────────

export const createCaseSchema = z.object({
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

  debtor_location: z
    .string()
    .max(200, "Location is too long")
    .optional()
    .or(z.literal("")),

  amount_owed: z
    .string()
    .min(1, "Amount is required")
    .refine(
      (v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0,
      { message: "Amount must be greater than RM 0.00" }
    ),

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
