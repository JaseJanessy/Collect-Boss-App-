"use client";
import { friendlyErrorMessage } from "@/lib/ui/friendly-error";

import { useCallback, useEffect, useState } from "react";
import type {
  CommunicationActivityRow,
  CommunicationCounters,
  CommunicationChannel,
  ContactFrequencyPolicy,
  ContactGuardEvaluation,
  ContactPreferenceRow,
} from "@/lib/supabase/types";
import type { CallOutcome } from "@/lib/communications/model";

export interface CommunicationActivityData {
  activities: CommunicationActivityRow[];
  case_counters: CommunicationCounters;
  customer_counters: CommunicationCounters;
  preferences: ContactPreferenceRow | null;
  policy: ContactFrequencyPolicy;
  guardrails: Record<"call" | "whatsapp" | "email", ContactGuardEvaluation>;
}

const emptyCounters: CommunicationCounters = {
  calls: 0, whatsapps: 0, emails: 0, last_contact_at: null, last_response_at: null,
};
const emptyData: CommunicationActivityData = {
  activities: [],
  case_counters: emptyCounters,
  customer_counters: emptyCounters,
  preferences: null,
  policy: {
    max_attempts_24h: 2,
    max_attempts_7d: 5,
    max_attempts_30d: 12,
    frequency_mode: "warn",
    preference_mode: "require_override",
    bulk_mode: "exclude",
  },
  guardrails: {} as CommunicationActivityData["guardrails"],
};

export function useCommunicationActivities(caseId: string, enabled = true) {
  const [data, setData] = useState<CommunicationActivityData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/communications`, {
        cache: "no-store",
      });
      const payload = await response.json() as CommunicationActivityData & { error?: string };
      if (!response.ok) throw new Error(friendlyErrorMessage(payload.error ?? "Unable to load communication activity."));
      setData(payload);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load communication activity.");
    } finally {
      setLoading(false);
    }
  }, [caseId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    fetch(`/api/cases/${encodeURIComponent(caseId)}/communications`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as CommunicationActivityData & { error?: string };
        if (!response.ok) throw new Error(friendlyErrorMessage(payload.error ?? "Unable to load communication activity."));
        return payload;
      })
      .then((payload) => {
        if (active) {
          setData(payload);
          setError(null);
        }
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : "Unable to load communication activity.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [caseId, enabled]);

  const initiate = useCallback(async (channel: "call" | "whatsapp", overrideReason?: string) => {
    const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/communications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel,
        direction: "outbound",
        status: "initiated",
        metadata: { adapter: channel === "call" ? "device_call_handoff_v1" : "whatsapp_handoff_v1" },
        override_reason: overrideReason,
        idempotency_key: crypto.randomUUID(),
      }),
    });
    const payload = await response.json() as {
      activity?: CommunicationActivityRow;
      guardrail?: ContactGuardEvaluation;
      error?: string;
    };
    if (!response.ok || !payload.activity) {
      return { error: payload.error ?? "Unable to log communication attempt.", guardrail: payload.guardrail };
    }
    await refresh();
    return { data: payload.activity };
  }, [caseId, refresh]);

  const savePreferences = useCallback(async (input: {
    preferred_channel: CommunicationChannel | null;
    preferred_time_start: string;
    preferred_time_end: string;
    email_only: boolean;
    do_not_call: boolean;
    wrong_number: boolean;
    invalid_contact: boolean;
    do_not_email: boolean;
    email_invalid: boolean;
    email_unsubscribed: boolean;
    note: string;
  }) => {
    const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/communications`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "preferences", ...input }),
    });
    const payload = await response.json() as { preferences?: ContactPreferenceRow; error?: string };
    if (!response.ok || !payload.preferences) return { error: payload.error ?? "Unable to save contact preferences." };
    await refresh();
    return { data: payload.preferences };
  }, [caseId, refresh]);

  const savePolicy = useCallback(async (input: ContactFrequencyPolicy) => {
    const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/communications`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "policy", ...input }),
    });
    const payload = await response.json() as { policy?: ContactFrequencyPolicy; error?: string };
    if (!response.ok || !payload.policy) return { error: payload.error ?? "Unable to save contact policy." };
    await refresh();
    return { data: payload.policy };
  }, [caseId, refresh]);

  const recordCallOutcome = useCallback(async (activityId: string, outcome: CallOutcome) => {
    const response = await fetch(
      `/api/cases/${encodeURIComponent(caseId)}/communications/${encodeURIComponent(activityId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed", outcome }),
      },
    );
    const payload = await response.json() as { activity?: CommunicationActivityRow; error?: string };
    if (!response.ok || !payload.activity) {
      return { error: payload.error ?? "Unable to save call outcome." };
    }
    await refresh();
    return { data: payload.activity };
  }, [caseId, refresh]);

  return { ...data, loading, error, refresh, initiate, recordCallOutcome, savePreferences, savePolicy };
}
