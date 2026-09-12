"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from "react";
import type { FinancialAdjustmentEventRow, FinancialAdjustmentRow } from "@/lib/supabase/types";

export function useFinancialAdjustments(caseId: string, enabled = true) {
  const [adjustments, setAdjustments] = useState<FinancialAdjustmentRow[]>([]);
  const [events, setEvents] = useState<FinancialAdjustmentEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/cases/${caseId}`, { cache: "no-store" });
      const payload = await response.json() as {
        adjustments?: FinancialAdjustmentRow[]; adjustmentEvents?: FinancialAdjustmentEventRow[]; error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Unable to load adjustments.");
      setAdjustments(payload.adjustments ?? []);
      setEvents(payload.adjustmentEvents ?? []);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load adjustments.");
    } finally {
      setLoading(false);
    }
  }, [caseId, enabled]);
  useEffect(() => { if (enabled) void refresh(); }, [enabled, refresh]);
  const submit = useCallback(async (input: Record<string, unknown>) => {
    const response = await fetch(`/api/cases/${caseId}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) return { error: payload.error ?? "Unable to update case finances." };
    await refresh();
    return {};
  }, [caseId, refresh]);
  return { adjustments, events, loading, error, refresh, submit };
}
