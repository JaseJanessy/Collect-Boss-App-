"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from "react";
import { getPaymentProofSubmissions, reviewPaymentProof, type PaymentProofDecision, type PaymentProofSubmission } from "@/lib/payment-proofs/client";

export function usePaymentProofs() {
  const [submissions, setSubmissions] = useState<PaymentProofSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSubmissions(await getPaymentProofSubmissions());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load payment proofs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const review = useCallback(async (id: string, decision: PaymentProofDecision, reason?: string) => {
    try {
      const status = await reviewPaymentProof(id, decision, reason);
      setSubmissions((current) => current.map((item) => item.id === id ? { ...item, status } : item));
      return { error: null };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : "Unable to review payment proof." };
    }
  }, []);

  return { submissions, loading, error, refresh, review };
}
