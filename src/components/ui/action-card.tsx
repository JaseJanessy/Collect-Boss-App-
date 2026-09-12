"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface ActionCardProps {
  icon: ReactNode;
  label: string;
  description: string;
  successRate?: string;
  onClick?: () => void;
  className?: string;
  variant?: "default" | "primary";
}

export function ActionCard({
  icon,
  label,
  description,
  successRate,
  onClick,
  className,
  variant = "default",
}: ActionCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl p-4 border text-center transition-all hover:shadow-md active:scale-95",
        variant === "primary"
          ? "border-[var(--cb-action-primary)] bg-[var(--cb-action-primary)] text-white hover:bg-[var(--cb-action-primary-hover)] active:bg-[var(--cb-action-primary-pressed)]"
          : "bg-white text-gray-800 border-gray-100 shadow-sm hover:border-emerald-200",
        className
      )}
    >
      <div
        className={cn(
          "w-11 h-11 rounded-xl flex items-center justify-center",
          variant === "primary" ? "bg-white/15" : "bg-[var(--cb-selected-surface)]"
        )}
      >
        <span className={variant === "primary" ? "text-white" : "text-[var(--cb-selected-text)]"}>
          {icon}
        </span>
      </div>
      <div>
        <p className="text-sm font-semibold leading-tight">{label}</p>
        <p
          className={cn(
            "text-xs mt-0.5",
            variant === "primary" ? "text-white/80" : "text-[var(--cb-text-secondary)]"
          )}
        >
          {description}
        </p>
        {successRate && (
          <p
            className={cn(
              "text-xs font-semibold mt-1",
              variant === "primary" ? "text-white/90" : "text-[var(--cb-selected-text)]"
            )}
          >
            {successRate} Success Rate
          </p>
        )}
      </div>
    </button>
  );
}
