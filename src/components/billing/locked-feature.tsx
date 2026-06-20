"use client";

/**
 * LockedFeature — replaces a feature card/section when the plan doesn't
 * include it. Shows what the feature does + "Upgrade to unlock" CTA.
 */

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Lock, ArrowRight } from "lucide-react";
import { PLAN_BADGE } from "@/lib/billing/plans";
import type { PlanSlug } from "@/lib/billing/types";

interface LockedFeatureProps {
  /** Feature name, e.g. "Formal Demand Letter" */
  feature:       string;
  /** One-line description of what this feature does */
  description:   string;
  /** Minimum plan slug that unlocks this */
  availableFrom: PlanSlug;
  /** Optional Lucide icon */
  icon?:         React.ReactNode;
  className?:    string;
}

export function LockedFeature({
  feature,
  description,
  availableFrom,
  icon,
  className,
}: LockedFeatureProps) {
  const badge = PLAN_BADGE[availableFrom];

  return (
    <div className={cn(
      "relative overflow-hidden rounded-2xl border border-gray-100 bg-white",
      className,
    )}>
      {/* Blurred / greyed content area */}
      <div className="px-5 py-6 opacity-30 select-none pointer-events-none">
        {icon && (
          <div className="w-10 h-10 rounded-xl bg-gray-200 flex items-center justify-center mb-4 text-gray-400">
            {icon}
          </div>
        )}
        <p className="text-sm font-black text-gray-800 mb-1.5">{feature}</p>
        <p className="text-xs text-gray-500 leading-relaxed">{description}</p>
      </div>

      {/* Lock overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/75 backdrop-blur-[2px] px-4 text-center">
        <div className="w-10 h-10 rounded-xl bg-[#0D1B3D]/8 flex items-center justify-center mb-3">
          <Lock className="w-5 h-5 text-[#0D1B3D]/50" />
        </div>

        <p className="text-xs font-black text-[#0D1B3D] mb-1">
          Upgrade to unlock this feature
        </p>
        <p className="text-[11px] text-gray-500 mb-3 leading-snug max-w-[200px]">
          {description}
        </p>

        {/* Plan badge */}
        <span className={cn(
          "text-[9px] font-bold border px-2 py-0.5 rounded-full mb-3",
          badge.color,
        )}>
          {badge.label} plan required
        </span>

        <Link
          href="/billing"
          className="flex items-center gap-1.5 text-[11px] font-bold text-white bg-[#009966] hover:bg-[#00B377] px-3.5 py-2 rounded-xl transition-colors"
        >
          View Plans <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}
