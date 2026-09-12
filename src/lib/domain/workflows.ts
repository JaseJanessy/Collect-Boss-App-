import type {
  CaseStatus,
  DisputeStatus,
  PaymentPromiseStatus,
  PaymentReviewStatus,
} from "@/lib/supabase/types";

export type StatusTone = "neutral" | "pending" | "success" | "warning" | "danger" | "closed";
export type StatusMetadata = { label: string; tone: StatusTone; terminal?: boolean };

export const CASE_STATUS_METADATA: Record<CaseStatus, StatusMetadata> = {
  action_needed: { label: "Action Needed", tone: "warning" },
  payment_promise: { label: "Promise to Pay", tone: "pending" },
  partial_paid: { label: "Partially Paid", tone: "pending" },
  paid: { label: "Paid", tone: "success" },
  overdue: { label: "Overdue", tone: "danger" },
  formal_demand_ready: { label: "Formal Demand Ready", tone: "warning" },
  closed: { label: "Closed", tone: "closed", terminal: true },
};

export const PAYMENT_STATUS_METADATA: Record<PaymentReviewStatus, StatusMetadata> = {
  pending_review: { label: "Pending Review", tone: "pending" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger", terminal: true },
  unmatched: { label: "Unmatched", tone: "warning" },
  reversed: { label: "Reversed", tone: "closed", terminal: true },
};

export const PROMISE_STATUS_METADATA: Record<PaymentPromiseStatus, StatusMetadata> = {
  pending: { label: "Pending", tone: "pending" },
  partially_fulfilled: { label: "Partially Fulfilled", tone: "pending" },
  fulfilled: { label: "Fulfilled", tone: "success", terminal: true },
  missed: { label: "Missed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "closed", terminal: true },
};

export const DISPUTE_STATUS_METADATA: Record<DisputeStatus, StatusMetadata> = {
  submitted: { label: "Submitted", tone: "pending" },
  under_review: { label: "Under Review", tone: "pending" },
  information_requested: { label: "Information Requested", tone: "warning" },
  partially_accepted: { label: "Partially Accepted", tone: "warning" },
  accepted: { label: "Accepted", tone: "success", terminal: true },
  rejected: { label: "Rejected", tone: "danger", terminal: true },
  resolved: { label: "Resolved", tone: "success", terminal: true },
  withdrawn: { label: "Withdrawn", tone: "closed", terminal: true },
};

const CASE_TRANSITIONS: Record<CaseStatus, readonly CaseStatus[]> = {
  action_needed: ["payment_promise", "partial_paid", "paid", "overdue", "formal_demand_ready"],
  payment_promise: ["action_needed", "partial_paid", "paid", "overdue", "formal_demand_ready"],
  partial_paid: ["action_needed", "payment_promise", "paid", "overdue", "formal_demand_ready"],
  paid: [],
  overdue: ["action_needed", "payment_promise", "partial_paid", "paid", "formal_demand_ready"],
  formal_demand_ready: ["action_needed", "payment_promise", "partial_paid", "paid", "overdue"],
  closed: [],
};

const PAYMENT_TRANSITIONS: Record<PaymentReviewStatus, readonly PaymentReviewStatus[]> = {
  pending_review: ["approved", "rejected", "unmatched"],
  unmatched: ["pending_review", "approved", "rejected"],
  approved: ["reversed"],
  rejected: [],
  reversed: [],
};

const PROMISE_TRANSITIONS: Record<PaymentPromiseStatus, readonly PaymentPromiseStatus[]> = {
  pending: ["partially_fulfilled", "fulfilled", "missed", "cancelled"],
  partially_fulfilled: ["fulfilled", "missed", "cancelled"],
  missed: ["partially_fulfilled", "fulfilled", "cancelled"],
  fulfilled: [],
  cancelled: [],
};

const DISPUTE_TRANSITIONS: Record<DisputeStatus, readonly DisputeStatus[]> = {
  submitted: ["under_review", "information_requested", "partially_accepted", "accepted", "rejected", "resolved", "withdrawn"],
  under_review: ["information_requested", "partially_accepted", "accepted", "rejected", "resolved", "withdrawn"],
  information_requested: ["under_review", "partially_accepted", "accepted", "rejected", "resolved", "withdrawn"],
  partially_accepted: ["resolved", "withdrawn"],
  accepted: [],
  rejected: [],
  resolved: [],
  withdrawn: [],
};

export type SettlementWorkflowStatus = "draft" | "ready" | "recorded" | "failed";
export type ClosureWorkflowStatus = "open" | "eligible" | "closed" | "archived";

const SETTLEMENT_TRANSITIONS: Record<SettlementWorkflowStatus, readonly SettlementWorkflowStatus[]> = {
  draft: ["ready"], ready: ["recorded", "failed"], failed: ["ready"], recorded: [],
};
const CLOSURE_TRANSITIONS: Record<ClosureWorkflowStatus, readonly ClosureWorkflowStatus[]> = {
  open: ["eligible"], eligible: ["closed"], closed: ["archived"], archived: [],
};

function includesTransition<T extends string>(map: Record<T, readonly T[]>, from: T, to: T) {
  return from === to || map[from].includes(to);
}

export const canTransitionCase = (from: CaseStatus, to: CaseStatus) => includesTransition(CASE_TRANSITIONS, from, to);
export const canTransitionPayment = (from: PaymentReviewStatus, to: PaymentReviewStatus) => includesTransition(PAYMENT_TRANSITIONS, from, to);
export const canTransitionPromise = (from: PaymentPromiseStatus, to: PaymentPromiseStatus) => includesTransition(PROMISE_TRANSITIONS, from, to);
export const canTransitionDispute = (from: DisputeStatus, to: DisputeStatus) => includesTransition(DISPUTE_TRANSITIONS, from, to);
export const canTransitionSettlement = (from: SettlementWorkflowStatus, to: SettlementWorkflowStatus) => includesTransition(SETTLEMENT_TRANSITIONS, from, to);
export const canTransitionClosure = (from: ClosureWorkflowStatus, to: ClosureWorkflowStatus) => includesTransition(CLOSURE_TRANSITIONS, from, to);

export function allowedCaseStatuses(from: CaseStatus) { return CASE_TRANSITIONS[from]; }
export function allowedDisputeStatuses(from: DisputeStatus) { return DISPUTE_TRANSITIONS[from]; }
