"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  PaymentPromiseAllocationRow,
  PaymentPromiseEventRow,
  PaymentPromiseRow,
  PaymentPromiseSource,
  PaymentRow,
} from "@/lib/supabase/types";

export interface PaymentPromiseData {
  promises: PaymentPromiseRow[];
  events: PaymentPromiseEventRow[];
  payments: PaymentRow[];
  allocations: PaymentPromiseAllocationRow[];
}

const emptyData: PaymentPromiseData = { promises: [], events: [], payments: [], allocations: [] };

export function usePaymentPromises(caseId: string, enabled = true) {
  const [data, setData] = useState<PaymentPromiseData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/cases/${caseId}/promises`, { cache: "no-store" });
      const payload = await response.json() as PaymentPromiseData & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to load payment promises.");
      setData(payload);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load payment promises.");
    } finally {
      setLoading(false);
    }
  }, [caseId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    fetch(`/api/cases/${caseId}/promises`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as PaymentPromiseData & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Unable to load payment promises.");
        return payload;
      })
      .then((payload) => {
        if (!active) return;
        setData(payload);
        setError(null);
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : "Unable to load payment promises.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [caseId, enabled]);

  const create = useCallback(async (input: {
    amount: string;
    promise_date: string;
    source: PaymentPromiseSource;
    source_activity_type?: string;
    source_activity_id?: string;
    note?: string;
    idempotency_key: string;
  }) => {
    const response = await fetch(`/api/cases/${caseId}/promises`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    const payload = await response.json() as { promise?: PaymentPromiseRow; error?: string };
    if (!response.ok) return { error: payload.error ?? "Unable to create payment promise." };
    await refresh();
    return { data: payload.promise };
  }, [caseId, refresh]);

  const update = useCallback(async (
    promiseId: string,
    input: Record<string, unknown>,
  ) => {
    const response = await fetch(`/api/cases/${caseId}/promises/${promiseId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    const payload = await response.json() as { promise?: PaymentPromiseRow; error?: string };
    if (!response.ok) return { error: payload.error ?? "Unable to update payment promise." };
    await refresh();
    return { data: payload.promise };
  }, [caseId, refresh]);

  return { ...data, loading, error, refresh, create, update };
}
