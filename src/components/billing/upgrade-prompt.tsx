"use client";

/**
 * UpgradePrompt — shown when a user hits a plan limit or locked feature.
 * Use the `inline` variant inside a form area, `page` for full-page blocks.
 */

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Lock, ArrowRight, Zap } from "lucide-react";

export interface UpgradePromptProps {
  /** Short feature name, e.g. "Formal Demand Letter" */
  feature:       string;
  /** Single-sentence reason, e.g. "Your Free plan allows 3 active cases." */
  reason?:       string;
  /** Extra detail or suggestion */
  description?:  string;
  /** Minimum plan that unlocks this, e.g. "Boss" */
  planRequired?: string;
  variant?:      "inline" | "page" | "banner";
  className?:    string;
}

export function UpgradePrompt({
  feature,
  reason,
  description,
  planRequired,
  variant = "inline",
  className,
}: UpgradePromptProps) {
  if (variant === "banner") {
    return (
      <div className={cn(
        "flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3",
        className,
      )}>
        <Lock className="w-4 h-4 text-amber-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-amber-800">{feature} — Upgrade required</p>
          {reason && (
            <p className="text-[11px] text-amber-700 mt-0.5">{reason}</p>
          )}
        </div>
        <Link
          href="/billing"
          className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-2.5 py-1.5 rounded-lg transition-colors"
        >
          View Plans <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    );
  }

  if (variant === "page") {
    return (
      <div className={cn(
        "flex flex-col items-center text-center py-16 px-6 max-w-sm mx-auto",
        className,
      )}>
        <div className="w-16 h-16 rounded-2xl bg-[#0D1B3D]/5 flex items-center justify-center mb-5">
          <Lock className="w-7 h-7 text-[#0D1B3D]/40" />
        </div>

        <p className="text-xs font-bold text-[#009966] uppercase tracking-widest mb-2">
          {planRequired ? `${planRequired} Plan Required` : "Upgrade Required"}
        </p>

        <h2 className="text-lg font-black text-[#0D1B3D] mb-3">{feature}</h2>

        {reason && (
          <p className="text-sm text-gray-500 leading-relaxed mb-2">{reason}</p>
        )}
        {description && (
          <p className="text-xs text-gray-400 leading-relaxed mb-6">{description}</p>
        )}
        {!description && reason && <div className="mb-4" />}

        <Link
          href="/billing"
          className="flex items-center gap-2 bg-[#009966] hover:bg-[#00B377] text-white font-bold text-sm px-6 py-3 rounded-2xl transition-colors"
        >
          <Zap className="w-4 h-4" />
          View Plans
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }

  // ── inline (default) ───────────────────────────────────────────────────────
  return (
    <div className={cn(
      "flex flex-col items-center text-center py-10 px-5 bg-gray-50 border border-gray-100 rounded-2xl",
      className,
    )}>
      <div className="w-12 h-12 rounded-xl bg-[#0D1B3D]/8 flex items-center justify-center mb-3">
        <Lock className="w-5 h-5 text-[#0D1B3D]/40" />
      </div>

      <p className="text-sm font-bold text-[#0D1B3D] mb-1">
        Upgrade to unlock this feature
      </p>

      {reason && (
        <p className="text-xs text-gray-500 leading-relaxed mb-1">{reason}</p>
      )}
      {description && (
        <p className="text-xs text-gray-400 leading-relaxed mb-4">{description}</p>
      )}
      {!description && <div className="mb-3" />}

      {planRequired && (
        <p className="text-[10px] font-bold text-gray-400 mb-3">
          Available from the <span className="text-[#009966]">{planRequired}</span> plan
        </p>
      )}

      <Link
        href="/billing"
        className="flex items-center gap-1.5 text-xs font-bold text-white bg-[#009966] hover:bg-[#00B377] px-4 py-2 rounded-xl transition-colors"
      >
        View Plans <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}
