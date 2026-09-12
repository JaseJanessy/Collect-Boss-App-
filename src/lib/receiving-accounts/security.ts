import { z } from "zod";

export const receivingAccountVerificationStates = [
  "unverified", "pending", "verified", "rejected", "disabled",
] as const;

const text = z.string().trim().min(1).max(160);
const nullableText = z.string().trim().max(160).optional().nullable();

export const receivingAccountCreateSchema = z.object({
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Choose a valid currency."),
  businessEntity: text,
  accountHolderName: text,
  bankName: text,
  paymentMethod: z.enum(["bank_transfer", "duitnow", "ewallet", "other"]),
  accountIdentifier: z.string().trim().min(6).max(160),
  duitnowId: nullableText,
  includeInReminders: z.boolean().default(true),
  isPrimary: z.boolean().default(false),
  confirmation: z.literal("CHANGE PAYMENT DESTINATION"),
});

export const receivingAccountUpdateSchema = receivingAccountCreateSchema.partial().extend({
  confirmation: z.literal("CHANGE PAYMENT DESTINATION"),
});

export function maskAccountIdentifier(value: string): string {
  const compact = value.replace(/\s/g, "");
  const visible = compact.slice(-4);
  return visible ? `${"*".repeat(Math.max(4, Math.min(8, compact.length - 4)))}${visible}` : "****";
}

export function isSelectableReceivingAccount(account: {
  is_active: boolean;
  verification_status: string;
}): boolean {
  return account.is_active && account.verification_status !== "rejected" && account.verification_status !== "disabled";
}
