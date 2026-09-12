import type { Json } from "@/lib/supabase/types";

export type FindingStatus = "open" | "confirmed" | "dismissed" | "deferred" | "resolved";

export interface DiscrepancyFindingDto {
  id: string;
  case_id: string;
  category: string;
  state_class: "suspicious" | "inconsistent" | "incomplete" | "confirmed_error";
  severity: "low" | "medium" | "high" | "critical";
  confidence: "deterministic" | "high" | "medium" | "low";
  confidence_score: number;
  impacted_amount_minor: string;
  currency: string;
  title: string;
  explanation: string;
  conflicting_values: Json;
  source_references: Json;
  recommended_action: string;
  status: FindingStatus;
  status_reason: string | null;
  deferred_until: string | null;
  corrective_workflow: Json | null;
  detected_at: string;
  last_detected_at: string;
}

export interface DiscrepancyEventDto {
  id: string;
  finding_id: string;
  event_type: string;
  from_status: FindingStatus | null;
  to_status: FindingStatus;
  reason: string | null;
  actor_type: "system" | "staff";
  created_at: string;
}

export interface DiscrepancyResponse {
  findings: DiscrepancyFindingDto[];
  events: DiscrepancyEventDto[];
  summary: { openCount: number; impactedAmountMinor: string };
}

