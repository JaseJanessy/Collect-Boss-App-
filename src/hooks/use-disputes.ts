"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  CaseRecoveryAmountsRow, DisputeEvidenceRow, DisputeEventRow, DisputeRow,
} from "@/lib/supabase/types";

interface DisputeData {
  disputes: DisputeRow[];
  evidence: DisputeEvidenceRow[];
  events: DisputeEventRow[];
  recovery: CaseRecoveryAmountsRow | null;
}
const emptyData: DisputeData = { disputes: [], evidence: [], events: [], recovery: null };

export function useDisputes(caseId: string, enabled = true) {
  const [data, setData] = useState<DisputeData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    const response = await fetch(`/api/cases/${caseId}/disputes`, { cache: "no-store" });
    const payload = await response.json() as DisputeData & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Unable to load disputes.");
    setData(payload); setError(null); setLoading(false);
  }, [caseId, enabled]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    fetch(`/api/cases/${caseId}/disputes`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as DisputeData & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Unable to load disputes.");
        return payload;
      })
      .then((payload) => { if (active) { setData(payload); setError(null); } })
      .catch((requestError: unknown) => { if (active) setError(requestError instanceof Error ? requestError.message : "Unable to load disputes."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [caseId, enabled]);
  const create = useCallback(async (input: Record<string, unknown>) => {
    const response = await fetch(`/api/cases/${caseId}/disputes`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) return { error: payload.error ?? "Unable to create dispute." };
    await refresh(); return {};
  }, [caseId, refresh]);
  const transition = useCallback(async (disputeId: string, input: Record<string, unknown>) => {
    const response = await fetch(`/api/cases/${caseId}/disputes/${disputeId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) return { error: payload.error ?? "Unable to update dispute." };
    await refresh(); return {};
  }, [caseId, refresh]);
  return { ...data, loading, error, create, transition };
}
