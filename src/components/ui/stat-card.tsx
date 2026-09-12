"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  icon?: ReactNode;
  trend?: string;
  trendUp?: boolean;
  className?: string;
  accent?: boolean;
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  trend,
  trendUp,
  className,
  accent,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl p-4 flex flex-col gap-1 border",
        accent
          ? "bg-[var(--cb-surface-inverse)] text-white border-[var(--cb-surface-inverse)]"
          : "bg-white text-gray-900 border-gray-100 shadow-sm",
        className
      )}
    >
      {icon && (
        <div className={cn("mb-1", accent ? "text-emerald-400" : "text-emerald-600")}>
          {icon}
        </div>
      )}
      <p className={cn("text-xs font-medium", accent ? "text-blue-200" : "text-gray-500")}>
        {label}
      </p>
      <p className={cn("text-xl font-bold leading-tight tracking-tight", accent ? "text-white" : "text-gray-900")}>
        {value}
      </p>
      {sub && (
        <p className={cn("text-xs", accent ? "text-blue-200" : "text-gray-400")}>
          {sub}
        </p>
      )}
      {trend && (
        <p
          className={cn(
            "text-xs font-medium mt-0.5",
            trendUp ? "text-emerald-500" : "text-red-500"
          )}
        >
          {trend}
        </p>
      )}
    </div>
  );
}
