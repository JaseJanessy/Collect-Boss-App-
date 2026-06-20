"use client";

/**
 * OnboardingChecklist — collapsible 6-step getting-started card.
 * Steps are tracked in localStorage via BetaContext.
 * Step 1 (first-case) is auto-detected from the cases array.
 */

import Link from "next/link";
import { cn } from "@/lib/utils";
import { useBeta, ONBOARDING_STEPS, type OnboardingStepId } from "@/contexts/beta-context";
import { useCases } from "@/hooks/use-cases";
import { useEffect } from "react";
import {
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronUp,
  Rocket,
  X,
  ArrowRight,
} from "lucide-react";

interface OnboardingChecklistProps {
  /** "dashboard" = desktop card style, "mobile" = compact card in feed */
  variant?: "dashboard" | "mobile";
}

export function OnboardingChecklist({ variant = "dashboard" }: OnboardingChecklistProps) {
  const {
    completedSteps,
    markStep,
    unmarkStep,
    checklistOpen,
    setChecklistOpen,
  } = useBeta();

  const { cases } = useCases();

  // Auto-detect: first case exists → mark step
  useEffect(() => {
    if (cases.length > 0 && !completedSteps.has("first-case")) {
      markStep("first-case");
    }
  }, [cases.length, completedSteps, markStep]);

  const totalSteps = ONBOARDING_STEPS.length;
  const doneCount  = ONBOARDING_STEPS.filter((s) => completedSteps.has(s.id)).length;
  const pct        = Math.round((doneCount / totalSteps) * 100);
  const allDone    = doneCount === totalSteps;

  // Hide the card once all steps are done and user collapses it
  if (allDone && !checklistOpen) return null;

  function toggleStep(id: OnboardingStepId) {
    if (completedSteps.has(id)) {
      unmarkStep(id);
    } else {
      markStep(id);
    }
  }

  if (variant === "mobile") {
    return (
      <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm overflow-hidden">
        {/* Header */}
        <button
          onClick={() => setChecklistOpen(!checklistOpen)}
          className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors"
        >
          <div className="w-8 h-8 rounded-xl bg-[#009966]/10 flex items-center justify-center shrink-0">
            <Rocket className="w-4 h-4 text-[#009966]" />
          </div>
          <div className="flex-1 text-left min-w-0">
            <p className="text-sm font-black text-[#0D1B3D] leading-tight">
              Getting Started
            </p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {doneCount} of {totalSteps} steps complete
            </p>
          </div>
          {/* Mini progress + chevron */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-1.5 bg-[#009966] rounded-full transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-[10px] font-bold text-[#009966]">{pct}%</span>
            {checklistOpen
              ? <ChevronUp  className="w-4 h-4 text-gray-400" />
              : <ChevronDown className="w-4 h-4 text-gray-400" />
            }
          </div>
        </button>

        {checklistOpen && (
          <div className="px-4 pb-4 flex flex-col gap-0">
            <div className="h-px bg-gray-100 mb-3" />
            {ONBOARDING_STEPS.map((step) => {
              const done = completedSteps.has(step.id);
              return (
                <div key={step.id} className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0">
                  <button
                    onClick={() => toggleStep(step.id)}
                    className="shrink-0 mt-0.5"
                    aria-label={done ? `Unmark ${step.label}` : `Mark ${step.label} complete`}
                  >
                    {done
                      ? <CheckCircle2 className="w-5 h-5 text-[#009966]" />
                      : <Circle       className="w-5 h-5 text-gray-300" />
                    }
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={cn(
                      "text-sm font-semibold leading-tight",
                      done ? "line-through text-gray-400" : "text-gray-800",
                    )}>
                      {step.label}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{step.description}</p>
                  </div>
                  {!done && (
                    <Link
                      href={step.href}
                      className="shrink-0 text-[#009966] hover:text-emerald-700 mt-0.5"
                    >
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                  )}
                </div>
              );
            })}

            {allDone && (
              <div className="mt-3 bg-emerald-50 border border-emerald-100 rounded-xl p-3 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#009966] shrink-0" />
                <p className="text-xs font-bold text-emerald-700">
                  All set! You&apos;re ready to collect smarter.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Dashboard variant ──────────────────────────────────────────────────────
  return (
    <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
        <div className="w-9 h-9 rounded-xl bg-[#009966]/10 flex items-center justify-center shrink-0">
          <Rocket className="w-5 h-5 text-[#009966]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-[#0D1B3D]">Getting Started</p>
          <p className="text-[11px] text-gray-500">
            {doneCount} of {totalSteps} steps complete
          </p>
        </div>

        {/* Progress bar + pct */}
        <div className="flex items-center gap-2.5 mr-2">
          <div className="w-32 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-2 bg-[#009966] rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs font-bold text-[#009966] w-8 text-right">{pct}%</span>
        </div>

        <button
          onClick={() => setChecklistOpen(!checklistOpen)}
          className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
          aria-label={checklistOpen ? "Collapse checklist" : "Expand checklist"}
        >
          {checklistOpen
            ? <ChevronUp  className="w-3.5 h-3.5 text-gray-600" />
            : <ChevronDown className="w-3.5 h-3.5 text-gray-600" />
          }
        </button>

        {allDone && (
          <button
            onClick={() => setChecklistOpen(false)}
            className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
            aria-label="Dismiss checklist"
          >
            <X className="w-3.5 h-3.5 text-gray-600" />
          </button>
        )}
      </div>

      {checklistOpen && (
        <div className="px-5 py-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            {ONBOARDING_STEPS.map((step) => {
              const done = completedSteps.has(step.id);
              return (
                <div key={step.id} className="flex items-start gap-2.5 py-2.5 border-b border-gray-50 last:border-0">
                  <button
                    onClick={() => toggleStep(step.id)}
                    className="shrink-0 mt-0.5"
                    aria-label={done ? `Unmark ${step.label}` : `Mark ${step.label} complete`}
                  >
                    {done
                      ? <CheckCircle2 className="w-5 h-5 text-[#009966]" />
                      : <Circle       className="w-5 h-5 text-gray-300 hover:text-gray-400 transition-colors" />
                    }
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={cn(
                      "text-xs font-semibold leading-tight",
                      done ? "line-through text-gray-400" : "text-gray-800",
                    )}>
                      {step.label}
                    </p>
                    <p className="text-[10px] text-gray-400 mt-0.5 leading-relaxed">
                      {step.description}
                    </p>
                  </div>
                  {!done && (
                    <Link
                      href={step.href}
                      className="shrink-0 text-[#009966] hover:text-emerald-700 mt-0.5 transition-colors"
                    >
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  )}
                </div>
              );
            })}
          </div>

          {allDone && (
            <div className="mt-4 bg-emerald-50 border border-emerald-100 rounded-xl p-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#009966] shrink-0" />
              <p className="text-xs font-bold text-emerald-700 flex-1">
                All done! You&apos;re set up and ready to collect smarter.
              </p>
              <button
                onClick={() => setChecklistOpen(false)}
                className="text-[10px] font-semibold text-emerald-600 hover:text-emerald-700"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
