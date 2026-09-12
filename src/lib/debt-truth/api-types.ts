import type { Json } from "@/lib/supabase/types";

export interface DebtTruthVersionDto {
  id: string;
  case_id: string;
  version: number;
  currency: string;
  original_principal_minor: string;
  invoiced_amount_minor: string;
  approved_adjustments_minor: string;
  approved_fees_minor: string;
  credit_notes_minor: string;
  confirmed_payments_minor: string;
  disputed_amount_minor: string;
  unverified_amount_minor: string;
  unverified_credit_minor: string;
  confirmed_outstanding_minor: string;
  total_displayed_exposure_minor: string;
  overpayment_minor: string;
  source_fingerprint: string;
  explanation_tree: Json;
  user_explanation: string;
  calculated_at: string;
}

export interface DebtTruthEventDto {
  id: string;
  event_kind: string;
  amount_minor: string;
  currency: string;
  approval_status: "approved" | "pending" | "rejected" | "reversed";
  source_table: string;
  source_id: string;
  source_version: number;
  evidence_citations: Json;
  reverses_event_id: string | null;
  reason: string | null;
  created_at: string;
}

export interface DebtTruthResponse {
  balance: DebtTruthVersionDto;
  versions: DebtTruthVersionDto[];
  events: DebtTruthEventDto[];
}
