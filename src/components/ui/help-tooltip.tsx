"use client";

import { HelpCircle } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface HelpTooltipProps {
  text:      string;
  className?: string;
}

/**
 * Inline help icon that shows a tooltip on hover/tap.
 * Usage:  <HelpTooltip text="Explain something briefly." />
 */
export function HelpTooltip({ text, className }: HelpTooltipProps) {
  const [visible, setVisible] = useState(false);

  return (
    <span
      className={cn("relative inline-flex items-center", className)}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
      onClick={() => setVisible((v) => !v)}
    >
      <HelpCircle className="w-3.5 h-3.5 text-gray-400 hover:text-[var(--cb-text-link)] cursor-pointer transition-colors shrink-0" />

      {visible && (
        <span
          role="tooltip"
          className={cn(
            "absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2",
            "w-56 rounded-xl bg-[var(--cb-surface-inverse)] text-white text-[11px] leading-relaxed",
            "px-3 py-2 shadow-lg pointer-events-none",
          )}
        >
          {text}
          {/* Arrow */}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[var(--cb-surface-inverse)]" />
        </span>
      )}
    </span>
  );
}
