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
          ? "bg-[#55DDB4] text-[#0B1B3A] border-[#55DDB4] hover:bg-[#8BE4CA]"
          : "bg-white text-gray-800 border-gray-100 shadow-sm hover:border-emerald-200",
        className
      )}
    >
      <div
        className={cn(
          "w-11 h-11 rounded-xl flex items-center justify-center",
          variant === "primary" ? "bg-[#0B1B3A]/10" : "bg-emerald-50"
        )}
      >
        <span className={variant === "primary" ? "text-[#0B1B3A]" : "text-emerald-600"}>
          {icon}
        </span>
      </div>
      <div>
        <p className="text-sm font-semibold leading-tight">{label}</p>
        <p
          className={cn(
            "text-xs mt-0.5",
            variant === "primary" ? "text-[#0B1B3A]/70" : "text-gray-400"
          )}
        >
          {description}
        </p>
        {successRate && (
          <p
            className={cn(
              "text-xs font-semibold mt-1",
              variant === "primary" ? "text-[#0B1B3A]/80" : "text-emerald-600"
            )}
          >
            {successRate} Success Rate
          </p>
        )}
      </div>
    </button>
  );
}
