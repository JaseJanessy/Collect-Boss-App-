import { z } from "zod";

/** Shared validation for the owner-safe profile API and its client form. */
export const businessProfileSchema = z
  .object({
    accountType: z.enum(["individual", "business"], { error: "Choose Individual or Business." }),
    displayName: z.string().trim().min(1, "Enter a display name.").max(160),
    legalName: z.string().trim().min(1, "Enter a legal name.").max(160),
    contactName: z.string().trim().min(1, "Enter a contact name.").max(160),
    registrationNo: z.string().trim().max(80).nullable(),
    industry: z.enum([
      "general", "professional_services", "retail", "construction", "property",
      "education", "healthcare", "financial_services", "financing_money_lending", "other",
    ], { error: "Choose an industry." }),
    phone: z.string().trim().min(1, "Enter a phone number.").max(50),
    email: z.string().trim().email("Enter a valid email address.").max(254),
    address: z.string().trim().max(500).nullable(),
  })
  .superRefine((value, context) => {
    if (value.accountType === "business" && !value.registrationNo) {
      context.addIssue({
        code: "custom",
        path: ["registrationNo"],
        message: "Enter a business registration number.",
      });
    }
  });

export type BusinessProfileInput = z.infer<typeof businessProfileSchema>;

export const creditLimitPolicySchema = z.object({
  creditLimitEnforcementEnabled: z.boolean(),
});
