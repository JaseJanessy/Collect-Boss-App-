import { z } from "zod";

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().nullable().transform((value) => value || null);

export const debtorWriteSchema = z
  .object({
    debtor_type: z.enum(["individual", "business"]),
    individual_name: optionalText(160),
    business_name: optionalText(160),
    contact_name: optionalText(160),
    registration_no: optionalText(80),
    phone: optionalText(30).refine(
      (value) => value === null || /^[0-9+().\-\s]{7,30}$/.test(value),
      "Enter a valid phone number."
    ),
    email: optionalText(254).refine(
      (value) => value === null || z.string().email().safeParse(value).success,
      "Enter a valid email address."
    ),
    address: optionalText(500),
  })
  .superRefine((value, context) => {
    if (value.debtor_type === "individual" && !value.individual_name) {
      context.addIssue({
        code: "custom",
        path: ["individual_name"],
        message: "Enter the individual's name.",
      });
    }
    if (value.debtor_type === "business" && !value.business_name) {
      context.addIssue({
        code: "custom",
        path: ["business_name"],
        message: "Enter the registered business name.",
      });
    }
  });

export type DebtorWriteInput = z.infer<typeof debtorWriteSchema>;

export function debtorDisplayName(input: Pick<DebtorWriteInput, "debtor_type" | "individual_name" | "business_name">) {
  return input.debtor_type === "business" ? input.business_name ?? "" : input.individual_name ?? "";
}
