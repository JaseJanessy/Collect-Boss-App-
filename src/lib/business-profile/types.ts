import type { AccountType } from "@/lib/supabase/types";

/** Owner-safe profile fields returned to the signed-in browser. */
export interface BusinessProfileDto {
  id: string;
  accountType: AccountType | null;
  displayName: string;
  legalName: string | null;
  contactName: string | null;
  registrationNo: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  logoObjectPath: string | null;
}
