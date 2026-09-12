"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  /** Announces a newly loaded empty result without interrupting the user. */
  announce?: boolean;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  announce = false,
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      role={announce ? "status" : undefined}
      className={cn(
        "flex min-h-56 flex-col items-center justify-center px-6 py-12 text-center",
        className
      )}
    >
      {icon && (
        <div aria-hidden="true" className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
          {icon}
        </div>
      )}
      <h3 className="text-base font-bold text-slate-800">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-slate-600">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
