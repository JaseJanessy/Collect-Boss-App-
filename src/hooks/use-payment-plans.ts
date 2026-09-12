"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState, useCallback } from "react";
import { type PaymentPlanRow } from "@/lib/supabase/types";
import { getPaymentPlansClient, type PaymentPlanDetails } from "@/lib/db/payment-plans-client";

export interface UsePaymentPlansState {
  plans:      PaymentPlanDetails[];
  activePlan: PaymentPlanDetails | null;
  loading:    boolean;
  error:      string | null;
  refresh:    () => void;
  addPlan:    (plan: PaymentPlanRow) => void;
  updatePlan: (updated: PaymentPlanRow) => void;
}

export function usePaymentPlans(caseId: string, enabled = true): UsePaymentPlansState {
  const [plans,   setPlans]   = useState<PaymentPlanDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    if (!caseId) { setLoading(false); return; }
    const result = await getPaymentPlansClient(caseId);
    if (result.error) setError(result.error);
    else              setPlans(result.data ?? []);
    setLoading(false);
  }, [caseId, enabled]);

  useEffect(() => { if (enabled) void load(); }, [enabled, load]);

  const activePlan = plans.find((p) => p.status === "pending_acceptance" || p.status === "active" || p.status === "defaulted") ?? null;

  const addPlan = useCallback((plan: PaymentPlanRow) => {
    setPlans((prev) => [{ ...plan, installments: [], events: [] }, ...prev]);
  }, []);

  const updatePlan = useCallback((updated: PaymentPlanRow) => {
    setPlans((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
  }, []);

  return { plans, activePlan, loading, error, refresh: load, addPlan, updatePlan };
}
