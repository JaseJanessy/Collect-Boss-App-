"use client";

import { useCallback, useEffect, useState } from "react";
import type { CasePrioritySummary } from "@/lib/cases/priority-summary";
import { isSupabaseConfigured } from "@/lib/supabase/client";

export function useCasePrioritySummary(caseId: string) {
  const [summary, setSummary] = useState<CasePrioritySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    if (!isSupabaseConfigured) {
      setSummary(null);
      setError("Authoritative case reconciliation requires a configured Supabase connection.");
      setLoading(false);
      return;
    }
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}`, { cache: "no-store" });
      const payload = await response.json() as { prioritySummary?: CasePrioritySummary; error?: string };
      if (!response.ok || !payload.prioritySummary) throw new Error(payload.error ?? "Unable to load the case priority summary.");
      setSummary(payload.prioritySummary);
      setError(null);
    } catch (caught) {
      setSummary(null);
      setError(caught instanceof Error ? caught.message : "Unable to load the case priority summary.");
    } finally {
      setLoading(false);
    }
  }, [caseId]);
  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);
  return { summary, loading, error, refresh };
}
