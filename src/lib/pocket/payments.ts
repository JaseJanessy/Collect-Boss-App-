import { z } from "zod";

export const pocketPaymentMethods = ["cash", "bank_transfer", "card", "cheque", "other"] as const;
export type PocketPaymentMethod = (typeof pocketPaymentMethods)[number];

export const pocketPaymentInputSchema = z.object({
  debtId: z.string().uuid(),
  amount: z.string().trim().min(1).max(40),
  expectedOutstandingMinor: z.number().int().safe().nonnegative(),
  paymentDate: z.string().date(),
  method: z.enum(pocketPaymentMethods),
  reference: z.string().trim().max(255).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
}).strict();

export const pocketPaymentPreviewSchema = z.object({ debtId: z.string().uuid(), amount: z.string().trim().min(1).max(40) }).strict();
export const pocketPaymentReversalSchema = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();

const databaseErrors: Record<string, { status:number; code:string; message:string }> = {
  POCKET_PAYMENT_NOT_AUTHORISED: { status:403, code:"FORBIDDEN", message:"You do not have permission to record this payment." },
  POCKET_PAYMENT_REVERSE_NOT_AUTHORISED: { status:403, code:"REVERSAL_FORBIDDEN", message:"Only the owner or an administrator can reverse this payment." },
  POCKET_DEBT_NOT_FOUND: { status:404, code:"DEBT_NOT_FOUND", message:"The selected Pocket debt is unavailable." },
  POCKET_DEBT_NOT_PAYABLE: { status:409, code:"DEBT_NOT_PAYABLE", message:"This debt cannot accept a payment in its current state." },
  POCKET_PAYMENT_STALE_BALANCE: { status:409, code:"STALE_BALANCE", message:"The balance changed before confirmation. Review the latest remaining amount." },
  POCKET_PAYMENT_AMOUNT_TOO_HIGH: { status:409, code:"AMOUNT_TOO_HIGH", message:"The payment is higher than the current remaining balance." },
  POCKET_PAYMENT_DUPLICATE_REFERENCE: { status:409, code:"DUPLICATE_REFERENCE", message:"That payment reference is already recorded." },
  POCKET_PAYMENT_CURRENCY_MISMATCH: { status:422, code:"CURRENCY_MISMATCH", message:"This payment currency does not match the debt currency." },
  POCKET_PAYMENT_INVALID_DATE: { status:400, code:"INVALID_PAYMENT_DATE", message:"Choose today or an earlier payment date." },
  POCKET_PAYMENT_INVALID_REQUEST: { status:400, code:"INVALID_PAYMENT", message:"Check the payment details and try again." },
  POCKET_PAYMENT_REVERSAL_CONFLICT: { status:409, code:"REVERSAL_CONFLICT", message:"This payment can no longer be reversed safely." },
  P17_IDEMPOTENCY_CONFLICT: { status:409, code:"IDEMPOTENCY_CONFLICT", message:"This retry key was already used for different payment details." },
  P17_ALLOCATION_NOT_FOUND: { status:404, code:"PAYMENT_NOT_FOUND", message:"Payment not found." },
  P17_ALLOCATION_ALREADY_REVERSED: { status:409, code:"ALREADY_REVERSED", message:"This payment was already reversed." },
  P17_REASON_REQUIRED: { status:400, code:"REASON_REQUIRED", message:"Enter a reversal reason of at least three characters." },
  LIMIT_REACHED: { status:409, code:"LIMIT_REACHED", message:"The reversal restored a debt that needs plan-limit review." },
};

export function pocketPaymentError(message?: string | null) {
  const entry = Object.entries(databaseErrors).find(([token]) => message?.includes(token))?.[1];
  return entry ?? { status:500, code:"PAYMENT_OPERATION_FAILED", message:"The payment operation could not be completed." };
}

export function paymentMethodLabel(method: string) {
  return method.split("_").map((part) => part[0]?.toUpperCase()+part.slice(1)).join(" ");
}
