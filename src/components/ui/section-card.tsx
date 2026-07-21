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
    <div className={cn("min-w-0 bg-white rounded-xl border border-gray-100 shadow-sm", className)}>
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-2">
          <h3 className="min-w-0 text-sm font-semibold text-gray-900 break-words">{title}</h3>
          {action && <div className="shrink-0 text-xs text-emerald-600 font-medium">{action}</div>}
        </div>
      )}
      <div className={cn(noPadding ? "" : "px-4 pb-4")}>{children}</div>
    </div>
  );
}
