"use client";

import { cn } from "@/lib/utils";

// Handles both db snake_case ("action_needed") and human-readable ("Action Needed")
const STATUS_DISPLAY: Record<string, { label: string; color: string }> = {
  // DB snake_case
  action_needed:       { label: "Action Needed",      color: "bg-purple-100 text-purple-700 border-purple-200" },
  payment_promise:     { label: "Payment Promise",     color: "bg-amber-100  text-amber-700  border-amber-200" },
  partial_paid:        { label: "Partial Paid",        color: "bg-blue-100   text-blue-700   border-blue-200" },
  paid:                { label: "Paid",                color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  overdue:             { label: "Overdue",             color: "bg-red-100    text-red-700    border-red-200" },
  formal_demand_ready: { label: "Formal Demand Ready", color: "bg-orange-100 text-orange-700 border-orange-200" },
  // Legacy human-readable (still used in some pages)
  "Action Needed":      { label: "Action Needed",      color: "bg-purple-100 text-purple-700 border-purple-200" },
  "Payment Promise":    { label: "Payment Promise",     color: "bg-amber-100  text-amber-700  border-amber-200" },
  "Partial Paid":       { label: "Partial Paid",        color: "bg-blue-100   text-blue-700   border-blue-200" },
  "Paid":               { label: "Paid",                color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  "Overdue":            { label: "Overdue",             color: "bg-red-100    text-red-700    border-red-200" },
  "Formal Demand Ready":{ label: "Formal Demand Ready", color: "bg-orange-100 text-orange-700 border-orange-200" },
};

interface StatusBadgeProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  status: any;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const display = STATUS_DISPLAY[status as string];
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border",
        display?.color ?? "bg-gray-100 text-gray-700 border-gray-200",
        className
      )}
    >
      {display?.label ?? String(status)}
    </span>
  );
}
