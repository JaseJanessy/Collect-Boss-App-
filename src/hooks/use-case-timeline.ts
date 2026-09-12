"use client";

import { useCallback, useEffect, useState } from "react";
import type { CaseTimelineEvent } from "@/lib/timeline/model";

export function useCaseTimeline(caseId: string, enabled = true) {
  const [events, setEvents] = useState<CaseTimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/cases/${caseId}/timeline`, { cache: "no-store" });
      const payload = await response.json() as { events?: CaseTimelineEvent[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to load timeline.");
      setEvents(payload.events ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load timeline.");
    } finally {
      setLoading(false);
    }
  }, [caseId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    fetch(`/api/cases/${caseId}/timeline`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { events?: CaseTimelineEvent[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Unable to load timeline.");
        return payload.events ?? [];
      })
      .then((payload) => { if (active) { setEvents(payload); setError(null); } })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load timeline.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [caseId, enabled]);
  return { events, loading, error, refresh };
}
