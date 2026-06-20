"use client";

/**
 * BetaContext — lightweight state for the private beta.
 * Tracks:
 *   • isDemoMode   – whether the demo-data banner is visible
 *   • completedSteps – localStorage-persisted onboarding progress
 */

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

// ─── Onboarding steps ─────────────────────────────────────────────────────────

export const ONBOARDING_STEPS = [
  {
    id:          "first-case",
    label:       "Create your first case",
    description: "Add a debtor and set the amount owed.",
    href:        "/add",
  },
  {
    id:          "first-evidence",
    label:       "Upload first evidence",
    description: "Attach invoices, contracts, or photos.",
    href:        "/cases",
  },
  {
    id:          "first-reminder",
    label:       "Generate first reminder",
    description: "Send a WhatsApp or SMS follow-up.",
    href:        "/actions",
  },
  {
    id:          "receiving-account",
    label:       "Add receiving account",
    description: "Set up your bank account or DuitNow.",
    href:        "/payments/account",
  },
  {
    id:          "payment-lock",
    label:       "Turn on payment lock",
    description: "Require approval before payments clear.",
    href:        "/payments/requests",
  },
  {
    id:          "first-payment",
    label:       "Record first payment",
    description: "Log a payment received from a debtor.",
    href:        "/cases",
  },
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]["id"];

// ─── Context shape ─────────────────────────────────────────────────────────────

interface BetaContextValue {
  /** True while the "You are viewing demo data" banner should be shown */
  isDemoMode:       boolean;
  dismissDemoMode:  () => void;

  /** Set of completed onboarding step IDs */
  completedSteps:   Set<OnboardingStepId>;
  markStep:         (id: OnboardingStepId) => void;
  unmarkStep:       (id: OnboardingStepId) => void;
  resetOnboarding:  () => void;

  /** Whether the checklist card is collapsed */
  checklistOpen:    boolean;
  setChecklistOpen: (v: boolean) => void;
}

const BetaContext = createContext<BetaContextValue | null>(null);

// ─── Provider ──────────────────────────────────────────────────────────────────

const LS_DEMO_KEY       = "cb_demo_dismissed";
const LS_STEPS_KEY      = "cb_onboarding_steps";
const LS_CHECKLIST_KEY  = "cb_checklist_open";

interface BetaState {
  isDemoMode:     boolean;
  completedSteps: Set<OnboardingStepId>;
  checklistOpen:  boolean;
}

const defaultBetaState: BetaState = {
  isDemoMode:     true,
  completedSteps: new Set(),
  checklistOpen:  true,
};

function readFromStorage(): BetaState {
  try {
    const isDemoMode     = localStorage.getItem(LS_DEMO_KEY) !== "1";
    const raw            = localStorage.getItem(LS_STEPS_KEY);
    const completedSteps = raw
      ? new Set(JSON.parse(raw) as OnboardingStepId[])
      : new Set<OnboardingStepId>();
    const openRaw        = localStorage.getItem(LS_CHECKLIST_KEY);
    const checklistOpen  = openRaw !== null ? openRaw === "1" : true;
    return { isDemoMode, completedSteps, checklistOpen };
  } catch {
    return { ...defaultBetaState };
  }
}

export function BetaProvider({ children }: { children: ReactNode }) {
  // Lazy initializer: safe on SSR (returns defaults when window is undefined),
  // reads localStorage immediately on the client — avoids needing a useEffect.
  const [state, setState] = useState<BetaState>(() => {
    if (typeof window === "undefined") return defaultBetaState;
    return readFromStorage();
  });

  const { isDemoMode, completedSteps, checklistOpen } = state;

  const dismissDemoMode = useCallback(() => {
    setState((p) => ({ ...p, isDemoMode: false }));
    try { localStorage.setItem(LS_DEMO_KEY, "1"); } catch { /* noop */ }
  }, []);

  const markStep = useCallback((id: OnboardingStepId) => {
    setState((p) => {
      const next = new Set(p.completedSteps);
      next.add(id);
      try { localStorage.setItem(LS_STEPS_KEY, JSON.stringify([...next])); } catch { /* noop */ }
      return { ...p, completedSteps: next };
    });
  }, []);

  const unmarkStep = useCallback((id: OnboardingStepId) => {
    setState((p) => {
      const next = new Set(p.completedSteps);
      next.delete(id);
      try { localStorage.setItem(LS_STEPS_KEY, JSON.stringify([...next])); } catch { /* noop */ }
      return { ...p, completedSteps: next };
    });
  }, []);

  const resetOnboarding = useCallback(() => {
    setState((p) => ({ ...p, completedSteps: new Set() }));
    try { localStorage.removeItem(LS_STEPS_KEY); } catch { /* noop */ }
  }, []);

  const setChecklistOpen = useCallback((v: boolean) => {
    setState((p) => ({ ...p, checklistOpen: v }));
    try { localStorage.setItem(LS_CHECKLIST_KEY, v ? "1" : "0"); } catch { /* noop */ }
  }, []);

  return (
    <BetaContext.Provider
      value={{
        isDemoMode,
        dismissDemoMode,
        completedSteps,
        markStep,
        unmarkStep,
        resetOnboarding,
        checklistOpen,
        setChecklistOpen,
      }}
    >
      {children}
    </BetaContext.Provider>
  );
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useBeta(): BetaContextValue {
  const ctx = useContext(BetaContext);
  if (!ctx) throw new Error("useBeta must be used inside <BetaProvider>");
  return ctx;
}
