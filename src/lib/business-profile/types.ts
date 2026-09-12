import type { AccountType } from "@/lib/supabase/types";

export type BusinessIndustry =
  | "general"
  | "professional_services"
  | "retail"
  | "construction"
  | "property"
  | "education"
  | "healthcare"
  | "financial_services"
  | "financing_money_lending"
  | "other";

export type BusinessVerificationState =
  | "unverified"
  | "pending"
  | "verified"
  | "rejected"
  | "restricted";

/** Owner-safe profile fields returned to the signed-in browser. */
export interface BusinessProfileDto {
  id: string;
  accountType: AccountType | null;
  displayName: string;
  legalName: string | null;
  contactName: string | null;
  registrationNo: string | null;
  industry: BusinessIndustry;
  verificationState: BusinessVerificationState;
  verificationSubmittedAt: string | null;
  verifiedAt: string | null;
  verificationPublicNote: string | null;
  paymentLinksRestrictedUntil: string | null;
  creditLimitEnforcementEnabled: boolean;
  phone: string | null;
  email: string | null;
  address: string | null;
  logoObjectPath: string | null;
}
