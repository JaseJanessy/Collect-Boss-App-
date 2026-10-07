"use client";
import { friendlyErrorMessage } from "@/lib/ui/friendly-error";

import { useCallback, useEffect, useState } from "react";
import type { DebtTruthResponse } from "@/lib/debt-truth/api-types";

export function useDebtTruth(caseId: string, enabled = true) {
  const [data, setData] = useState<DebtTruthResponse | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/debt-truth?history=true`, { cache: "no-store" });
      const body = await response.json() as DebtTruthResponse & { error?: { message?: string } };
      if (!response.ok) throw new Error(friendlyErrorMessage(body.error?.message ?? "Unable to load the canonical debt ledger."));
      setData(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load the canonical debt ledger.");
    } finally { setLoading(false); }
  }, [caseId, enabled]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    fetch(`/api/cases/${encodeURIComponent(caseId)}/debt-truth?history=true`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as DebtTruthResponse & { error?: { message?: string } };
        if (!response.ok) throw new Error(friendlyErrorMessage(body.error?.message ?? "Unable to load the canonical debt ledger."));
        if (active) setData(body);
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Unable to load the canonical debt ledger."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [caseId, enabled]);
  return { data, loading, error, refresh };
}
