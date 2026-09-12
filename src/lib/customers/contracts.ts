import type { DebtorRow } from "@/lib/supabase/types";
import type { DebtorWriteInput } from "@/lib/validations/debtor";

export type CustomerRecord = DebtorRow;
export type CustomerWriteInput = DebtorWriteInput;

export interface CustomerListResponse {
  debtors: CustomerRecord[];
}

export interface CustomerWriteResponse {
  debtor: CustomerRecord;
}

export interface CustomerDuplicateResponse {
  error: string;
  duplicates: CustomerRecord[];
}
