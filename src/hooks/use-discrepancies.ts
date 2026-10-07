"use client";
import { friendlyErrorMessage } from "@/lib/ui/friendly-error";

import { useCallback, useEffect, useState } from "react";
import type { DiscrepancyResponse, FindingStatus } from "@/lib/discrepancies/api-types";

type Mutation = {
  findingId: string;
  status: FindingStatus;
  reason?: string;
  deferredUntil?: string;
  correctiveWorkflow?: { href: string; kind: string };
};

export function useDiscrepancies(caseId: string, enabled = true) {
  const [data, setData] = useState<DiscrepancyResponse | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async (body?: Record<string, unknown>) => {
    const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/discrepancies`, body ? {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    } : { cache: "no-store" });
    const payload = await response.json() as DiscrepancyResponse & { error?: { message?: string } };
    if (!response.ok) throw new Error(friendlyErrorMessage(payload.error?.message ?? "Unable to load discrepancy findings."));
    setData(payload); return payload;
  }, [caseId]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    fetch(`/api/cases/${encodeURIComponent(caseId)}/discrepancies`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as DiscrepancyResponse & { error?: { message?: string } };
        if (!response.ok) throw new Error(friendlyErrorMessage(payload.error?.message ?? "Unable to load discrepancy findings."));
        if (active) setData(payload);
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Unable to load discrepancy findings."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [caseId, enabled]);

  const scan = useCallback(async () => {
    setBusy("scan"); setError(null);
    try { return await request({ action: "scan" }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to scan discrepancy sources."); return null; }
    finally { setBusy(null); }
  }, [request]);

  const transition = useCallback(async (input: Mutation) => {
    setBusy(input.findingId); setError(null);
    try { return await request({ action: "transition", ...input }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update the finding."); return null; }
    finally { setBusy(null); }
  }, [request]);

  return { data, loading, busy, error, scan, transition };
}
