"use client";
import { friendlyErrorMessage } from "@/lib/ui/friendly-error";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from "react";
import type {
  PaymentNegotiationEventRow,
  PaymentNegotiationRevisionRow,
  PaymentNegotiationRow,
} from "@/lib/supabase/types";

export interface PaymentNegotiationData {
  negotiations: PaymentNegotiationRow[];
  negotiationRevisions: PaymentNegotiationRevisionRow[];
  negotiationEvents: PaymentNegotiationEventRow[];
}

const emptyData: PaymentNegotiationData = {
  negotiations: [], negotiationRevisions: [], negotiationEvents: [],
};

export function usePaymentNegotiations(caseId: string) {
  const [data, setData] = useState<PaymentNegotiationData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/cases/${caseId}/payment-plans`, { cache: "no-store" });
      const payload = await response.json() as PaymentNegotiationData & { error?: string };
      if (!response.ok) throw new Error(friendlyErrorMessage(payload.error ?? "Unable to load payment negotiations."));
      setData({
        negotiations: payload.negotiations ?? [],
        negotiationRevisions: payload.negotiationRevisions ?? [],
        negotiationEvents: payload.negotiationEvents ?? [],
      });
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load payment negotiations.");
    } finally {
      setLoading(false);
    }
  }, [caseId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const transition = useCallback(async (input: Record<string, unknown>) => {
    const response = await fetch(`/api/cases/${caseId}/payment-plans`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) return { error: payload.error ?? "Unable to update negotiation." };
    await refresh();
    return {};
  }, [caseId, refresh]);
  return { ...data, loading, error, refresh, transition };
}
