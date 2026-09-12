import type { ActionCentrePriority } from "@/lib/supabase/types";

export const actionQueues = [
  "promises",
  "payment_proofs",
  "disputes",
  "evidence",
  "approvals",
  "integrations",
  "discrepancies",
  "compliance",
  "payment_plans",
  "follow_ups",
  "other",
] as const;

export type ActionQueue = (typeof actionQueues)[number];
export type ActionDueFilter = "overdue" | "today" | "next_7_days" | "no_due_date";

export const actionQueueLabels: Record<ActionQueue, string> = {
  promises: "Overdue promises",
  payment_proofs: "Payment proofs",
  disputes: "New disputes",
  evidence: "Missing evidence",
  approvals: "Approvals",
  integrations: "Failed integrations",
  discrepancies: "Balance discrepancies",
  compliance: "Compliance alerts",
  payment_plans: "Payment plans",
  follow_ups: "Follow-ups",
  other: "Other",
};

export const priorityRank: Record<ActionCentrePriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Presentation mirror of public.action_centre_queue(). The database function is
 * authoritative for filtering and ordering; this mirror keeps labels stable.
 */
export function queueForActionType(type: string): ActionQueue {
  if (type === "promise.missed") return "promises";
  if (type === "review_payment_proof") return "payment_proofs";
  if (type === "review_dispute") return "disputes";
  if (type === "missing_evidence") return "evidence";
  if (type === "approval_required") return "approvals";
  if (type === "integration_failed") return "integrations";
  if (type === "review_discrepancy") return "discrepancies";
  if (type === "compliance_alert" || type === "review_payment_access_report") return "compliance";
  if (type.startsWith("payment_plan.")) return "payment_plans";
  if (type === "follow_up.due") return "follow_ups";
  return "other";
}

export function formatActionAge(ageSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(ageSeconds));
  const days = Math.floor(safeSeconds / 86_400);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(safeSeconds / 3_600);
  if (hours > 0) return `${hours}h`;
  const minutes = Math.floor(safeSeconds / 60);
  return minutes > 0 ? `${minutes}m` : "Just now";
}
