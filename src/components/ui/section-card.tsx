"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface SectionCardProps {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  noPadding?: boolean;
}

export function SectionCard({
  title,
  action,
  children,
  className,
  noPadding,
}: SectionCardProps) {
  return (
    <div className={cn("cb-surface", className)}>
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--cb-divider)] px-5 py-4">
          <h3 className="min-w-0 text-sm font-semibold text-gray-900 break-words">{title}</h3>
          {action && <div className="shrink-0 text-xs text-emerald-600 font-medium">{action}</div>}
        </div>
      )}
      <div className={cn(noPadding ? "" : "p-5")}>{children}</div>
    </div>
  );
}
