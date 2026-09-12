import type { ActionCentreItemRow, ContactGuardEvaluation } from "@/lib/supabase/types";
import type { ActionQueue } from "@/lib/action-centre/priority";

export interface ActionCentreViewItem extends ActionCentreItemRow {
  customer_name: string;
  outstanding_minor: number;
  owner_name: string;
  age_seconds: number;
  queue: ActionQueue;
  case_type: string | null;
  contact_guard: ContactGuardEvaluation | null;
}

export interface ActionCentrePayload {
  items: ActionCentreViewItem[];
  summary: {
    actionCount: number;
    amountMinor: number;
    actionableCaseCount: number;
    totalsByCurrency: Array<{ currency: string; amountMinor: number }>;
    byPriority: Partial<Record<ActionCentreItemRow["priority"], number>>;
    byQueue: Partial<Record<ActionQueue, number>>;
  };
  filters: {
    owners: Array<{ id: string; label: string }>;
    queues: ActionQueue[];
    caseTypes: string[];
  };
  page: { nextCursor: string | null; hasMore: boolean };
  permissions: { canFilterTeam: boolean };
}

export type ActionCentreScope = "active" | "history";
export type ActionCentreTransition = "reopen" | "start" | "snooze" | "complete" | "dismiss";

export interface ActionCentreFilters {
  owner?: string;
  queue?: ActionQueue;
  caseType?: string;
  severity?: ActionCentreItemRow["priority"];
  due?: "overdue" | "today" | "next_7_days" | "no_due_date";
}
