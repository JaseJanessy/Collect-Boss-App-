"use client";

/**
 * UsageMeter — shows current vs plan limit with a progress bar.
 * Turns amber at 80%, red at 100%.
 */

import Link from "next/link";
import { cn } from "@/lib/utils";
import { AlertCircle } from "lucide-react";

interface UsageMeterProps {
  label:      string;            // e.g. "Active cases"
  current:    number;
  limit:      number;            // -1 = unlimited
  className?: string;
  showUpgrade?: boolean;         // show "Upgrade" link when at limit
}

export function UsageMeter({
  label,
  current,
  limit,
  className,
  showUpgrade = true,
}: UsageMeterProps) {
  const isUnlimited = limit === -1;

  const pct = isUnlimited
    ? 0
    : limit > 0
      ? Math.min(100, Math.round((current / limit) * 100))
      : 100;

  const isWarning = !isUnlimited && pct >= 80 && pct < 100;
  const isAtLimit = !isUnlimited && current >= limit;

  const barColor = isAtLimit
    ? "bg-red-500"
    : isWarning
    ? "bg-amber-400"
    : "bg-[#009966]";

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-gray-600">{label}</span>
        <span className={cn(
          "text-[11px] font-bold",
          isAtLimit  ? "text-red-600"
          : isWarning ? "text-amber-600"
          : "text-gray-700",
        )}>
          {isUnlimited
            ? <span className="text-[#009966]">Unlimited</span>
            : `${current} / ${limit}`
          }
        </span>
      </div>

      {!isUnlimited && (
        <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
          <div
            className={cn("h-1.5 rounded-full transition-all duration-500", barColor)}
            style={{ width: `${Math.max(0, pct)}%` }}
          />
        </div>
      )}

      {isAtLimit && showUpgrade && (
        <div className="flex items-center gap-1.5 mt-0.5">
          <AlertCircle className="w-3 h-3 text-red-500 shrink-0" />
          <p className="text-[10px] text-red-600 flex-1">
            You have reached your plan limit.
          </p>
          <Link
            href="/billing"
            className="text-[10px] font-bold text-[#009966] hover:underline shrink-0"
          >
            View Plans →
          </Link>
        </div>
      )}

      {isWarning && !isAtLimit && (
        <p className="text-[10px] text-amber-600">
          Approaching plan limit — {limit - current} remaining.
        </p>
      )}
    </div>
  );
}
