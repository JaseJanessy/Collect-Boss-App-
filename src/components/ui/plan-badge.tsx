"use client";

import { cn } from "@/lib/utils";
import type { PlanSlug } from "@/lib/billing/types";
import { PLAN_BADGE } from "@/lib/billing/plans";

interface PlanBadgeProps {
  slug:       PlanSlug;
  className?: string;
  /** "sm" = tiny pill for inline use, "md" = default, "lg" = settings header */
  size?:      "sm" | "md" | "lg";
}

export function PlanBadge({ slug, className, size = "md" }: PlanBadgeProps) {
  const { label, color } = PLAN_BADGE[slug] ?? PLAN_BADGE.free;

  return (
    <span
      className={cn(
        "inline-flex items-center font-bold border rounded-full",
        size === "sm" && "text-[9px] px-1.5 py-0.5",
        size === "md" && "text-[10px] px-2 py-0.5",
        size === "lg" && "text-xs px-2.5 py-1",
        color,
        className,
      )}
    >
      {label}
    </span>
  );
}
