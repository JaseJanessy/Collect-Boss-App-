"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  CircleDot,
  Clock3,
  ShieldCheck,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CASE_STATUS_METADATA, DISPUTE_STATUS_METADATA, PAYMENT_STATUS_METADATA, PROMISE_STATUS_METADATA } from "@/lib/domain/workflows";

export type SemanticStatus =
  | "verified"
  | "pending"
  | "disputed"
  | "overdue"
  | "failed"
  | "closed"
  | "warning"
  | "high-risk";

type StatusDefinition = {
  label: string;
  semantic: SemanticStatus;
};

const SEMANTIC_STYLES: Record<SemanticStatus, { color: string; icon: LucideIcon }> = {
  verified: { color: "border-[var(--cb-success-border)] bg-[var(--cb-success-surface)] text-[var(--cb-success)]", icon: ShieldCheck },
  pending: { color: "border-[var(--cb-warning-border)] bg-[var(--cb-warning-surface)] text-[var(--cb-warning)]", icon: Clock3 },
  disputed: { color: "border-[var(--cb-information-border)] bg-[var(--cb-information-surface)] text-[var(--cb-information)]", icon: CircleAlert },
  overdue: { color: "border-[var(--cb-danger-border)] bg-[var(--cb-danger-surface)] text-[var(--cb-danger-strong)]", icon: AlertTriangle },
  failed: { color: "border-[var(--cb-danger-border)] bg-[var(--cb-danger-surface)] text-[var(--cb-danger-strong)]", icon: XCircle },
  closed: { color: "border-[var(--cb-neutral-border)] bg-[var(--cb-neutral-surface)] text-[var(--cb-neutral)]", icon: CheckCircle2 },
  warning: { color: "border-[var(--cb-warning-border)] bg-[var(--cb-warning-surface)] text-[var(--cb-warning)]", icon: AlertTriangle },
  "high-risk": { color: "border-[var(--cb-high-risk-border)] bg-[var(--cb-high-risk-surface)] text-[var(--cb-high-risk)]", icon: CircleAlert },
};

const STATUS_DISPLAY: Record<string, StatusDefinition> = {
  action_needed: { label: CASE_STATUS_METADATA.action_needed.label, semantic: "high-risk" },
  payment_promise: { label: CASE_STATUS_METADATA.payment_promise.label, semantic: "pending" },
  partial_paid: { label: CASE_STATUS_METADATA.partial_paid.label, semantic: "pending" },
  paid: { label: CASE_STATUS_METADATA.paid.label, semantic: "verified" },
  verified: { label: "Verified", semantic: "verified" },
  approved: { label: PAYMENT_STATUS_METADATA.approved.label, semantic: "verified" },
  confirmed: { label: "Confirmed", semantic: "verified" },
  pending: { label: "Pending", semantic: "pending" },
  pending_review: { label: PAYMENT_STATUS_METADATA.pending_review.label, semantic: "pending" },
  submitted: { label: DISPUTE_STATUS_METADATA.submitted.label, semantic: "pending" },
  under_review: { label: DISPUTE_STATUS_METADATA.under_review.label, semantic: "pending" },
  disputed: { label: "Disputed", semantic: "disputed" },
  dispute_open: { label: "Dispute Open", semantic: "disputed" },
  overdue: { label: CASE_STATUS_METADATA.overdue.label, semantic: "overdue" },
  failed: { label: "Failed", semantic: "failed" },
  rejected: { label: PAYMENT_STATUS_METADATA.rejected.label, semantic: "failed" },
  closed: { label: CASE_STATUS_METADATA.closed.label, semantic: "closed" },
  warning: { label: "Warning", semantic: "warning" },
  high_risk: { label: "High Risk", semantic: "high-risk" },
  formal_demand_ready: { label: CASE_STATUS_METADATA.formal_demand_ready.label, semantic: "warning" },
  "Action Needed": { label: "Action Needed", semantic: "high-risk" },
  "Payment Promise": { label: PROMISE_STATUS_METADATA.pending.label, semantic: "pending" },
  "Partial Paid": { label: "Partially Paid", semantic: "pending" },
  Paid: { label: "Paid", semantic: "verified" },
  Overdue: { label: "Overdue", semantic: "overdue" },
  "Formal Demand Ready": { label: CASE_STATUS_METADATA.formal_demand_ready.label, semantic: "warning" },
};

interface StatusBadgeProps {
  status: string | null | undefined;
  className?: string;
  semantic?: SemanticStatus;
  label?: string;
}

export function StatusBadge({ status, className, semantic, label }: StatusBadgeProps) {
  const rawStatus = status == null ? "unknown" : String(status);
  const display = STATUS_DISPLAY[rawStatus];
  const resolvedSemantic = semantic ?? display?.semantic ?? "closed";
  const resolvedLabel = label ?? display?.label ?? rawStatus.replaceAll("_", " ");
  const style = SEMANTIC_STYLES[resolvedSemantic];
  const Icon = style.icon ?? CircleDot;

  return (
    <span
      data-slot="status-badge"
      data-status={resolvedSemantic}
      className={cn(
        "inline-flex min-h-6 w-fit max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold leading-tight",
        style.color,
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span>{resolvedLabel}</span>
    </span>
  );
}

export { STATUS_DISPLAY, SEMANTIC_STYLES };
