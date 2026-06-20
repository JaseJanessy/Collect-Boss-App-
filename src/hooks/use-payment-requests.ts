"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState, useCallback } from "react";
import { type PaymentAccessRequestRow, type AccessType } from "@/lib/supabase/types";
import {
  getPaymentAccessRequestsClient,
  approvePaymentAccessClient,
  rejectPaymentAccessClient,
  markSentManuallyClient,
} from "@/lib/db/payment-access-client";

export interface UsePaymentRequestsState {
  requests:       PaymentAccessRequestRow[];
  loading:        boolean;
  error:          string | null;
  refresh:        () => void;
  approve:        (id: string, type: AccessType) => Promise<{ error: string | null }>;
  reject:         (id: string) => Promise<{ error: string | null }>;
  markManual:     (id: string) => Promise<{ error: string | null }>;
}

export function usePaymentRequests(): UsePaymentRequestsState {
  const [requests, setRequests] = useState<PaymentAccessRequestRow[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await getPaymentAccessRequestsClient();
    if (result.error) setError(result.error);
    else              setRequests(result.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  function patchRequest(id: string, patch: Partial<PaymentAccessRequestRow>) {
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  const approve = useCallback(async (id: string, type: AccessType) => {
    const result = await approvePaymentAccessClient(id, type);
    if (!result.error) patchRequest(id, result.data!);
    return { error: result.error };
  }, []);

  const reject = useCallback(async (id: string) => {
    const result = await rejectPaymentAccessClient(id);
    if (!result.error) patchRequest(id, result.data!);
    return { error: result.error };
  }, []);

  const markManual = useCallback(async (id: string) => {
    const result = await markSentManuallyClient(id);
    if (!result.error) patchRequest(id, result.data!);
    return { error: result.error };
  }, []);

  return { requests, loading, error, refresh: load, approve, reject, markManual };
}
