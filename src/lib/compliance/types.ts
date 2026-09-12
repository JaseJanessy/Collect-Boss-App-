import type { CommunicationChannel, ContactFrequencyCounts, ContactPreferenceRow, Json } from "@/lib/supabase/types";

export const complianceApprovalLevels = ["automatic", "agent", "supervisor", "legal", "prohibited"] as const;
export type ComplianceApprovalLevel = (typeof complianceApprovalLevels)[number];
export type ComplianceCheckResult = "allow" | "approval_required" | "prohibited";
export type SensitiveCaseCategory =
  | "identity_theft"
  | "paid_in_full_dispute"
  | "legal_representation"
  | "serious_complaint"
  | "vulnerability"
  | "bereavement"
  | "wrong_party";

export interface CompliancePhraseRule {
  id: string;
  phrases: string[];
  approval: ComplianceApprovalLevel;
  warning: string;
}

export interface CompliancePolicyRules {
  policy_notice: string;
  contact_windows: Partial<Record<CommunicationChannel, {
    start: string;
    end: string;
    days: number[];
  }>>;
  frequency: {
    max_attempts_24h: number;
    max_attempts_7d: number;
    max_attempts_30d: number;
  };
  prohibited_phrases: CompliancePhraseRule[];
  threat_indicators: string[];
  authority_impersonation_indicators: string[];
  unsupported_legal_claim_indicators: string[];
  third_party_disclosure_indicators: string[];
  sensitive_case_indicators: Record<SensitiveCaseCategory, string[]>;
  unverified_balance: {
    block_amount_references: boolean;
    amount_reference_indicators: string[];
  };
  approval_thresholds: {
    amount_minor_supervisor: number | null;
    bulk_requires_supervisor: boolean;
  };
}

export interface CompliancePolicyVersion {
  id: string;
  jurisdiction: string;
  version: string;
  status: "draft" | "counsel_approved" | "retired";
  effective_from: string;
  effective_until: string | null;
  rules: CompliancePolicyRules;
}

export interface ComplianceEvaluationInput {
  caseId: string;
  channel: CommunicationChannel;
  subject?: string | null;
  bodyText?: string | null;
  recipients?: string[];
  timezone: string;
  now: Date;
  counts: ContactFrequencyCounts;
  preferences: ContactPreferenceRow | null;
  confirmedOutstandingMinor: number;
  unverifiedBalanceMinor: number;
  requestedAmountMinor?: number | null;
  bulk?: boolean;
  activeSensitiveCategories?: SensitiveCaseCategory[];
}

export interface ComplianceEvaluation {
  policy_version_id: string;
  policy_version: string;
  jurisdiction: string;
  result: ComplianceCheckResult;
  required_approval: ComplianceApprovalLevel;
  warnings: string[];
  signals: string[];
  sensitive_case_triggers: SensitiveCaseCategory[];
  pauses_automation: boolean;
  evaluated_at: string;
  policy_notice: string;
}

export interface ComplianceCheckRow {
  id: string;
  business_id: string;
  case_id: string;
  policy_version_id: string;
  action_kind: string;
  channel: CommunicationChannel | null;
  content_hash: string;
  result: ComplianceCheckResult;
  required_approval: ComplianceApprovalLevel;
  warnings: Json;
  signals: Json;
  approval_state: "approved" | "pending" | "rejected" | "invalidated" | "prohibited";
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  approval_note: string | null;
  bypassed: boolean;
  bypass_reason: string | null;
  expires_at: string;
  final_action: string | null;
  executed_at: string | null;
  invalidated_at: string | null;
  created_at: string;
  updated_at: string;
}
