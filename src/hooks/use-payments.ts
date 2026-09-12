"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState, useCallback } from "react";
import { type PaymentRow } from "@/lib/supabase/types";
import {
  getPaymentsClient,
  approvePaymentClient,
  rejectPaymentClient,
  markUnmatchedPaymentClient,
} from "@/lib/db/payments-client";
import { useBusinessId } from "@/hooks/use-business-id";

export interface UsePaymentsState {
  payments:      PaymentRow[];
  loading:       boolean;
  error:         string | null;
  refresh:       () => void;
  approve:       (id: string) => Promise<{ error: string | null }>;
  reject:        (id: string) => Promise<{ error: string | null }>;
  markUnmatched: (id: string) => Promise<{ error: string | null }>;
}

export function usePayments(caseId?: string, enabled = true): UsePaymentsState {
  const businessId = useBusinessId();
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    const result = await getPaymentsClient(caseId);
    if (result.error) setError(result.error);
    else              setPayments(result.data ?? []);
    setLoading(false);
  }, [caseId, enabled]);

  useEffect(() => { if (enabled) void load(); }, [enabled, load]);

  function patchPayment(id: string, patch: Partial<PaymentRow>) {
    setPayments((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  const approve = useCallback(async (id: string) => {
    const bId   = businessId ?? "mock-business-id";
    const result = await approvePaymentClient(id, bId);
    if (!result.error && result.data) patchPayment(id, result.data);
    return { error: result.error };
  }, [businessId]);

  const reject = useCallback(async (id: string) => {
    const bId   = businessId ?? "mock-business-id";
    const result = await rejectPaymentClient(id, bId);
    if (!result.error && result.data) patchPayment(id, result.data);
    return { error: result.error };
  }, [businessId]);

  const markUnmatched = useCallback(async (id: string) => {
    const bId   = businessId ?? "mock-business-id";
    const result = await markUnmatchedPaymentClient(id, bId);
    if (!result.error && result.data) patchPayment(id, result.data);
    return { error: result.error };
  }, [businessId]);

  return { payments, loading, error, refresh: load, approve, reject, markUnmatched };
}
