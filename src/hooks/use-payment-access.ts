"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState, useCallback } from "react";
import { type PaymentAccessRequestRow, type AccessType } from "@/lib/supabase/types";
import {
  getRequestByIdClient,
  approvePaymentAccessClient,
  rejectPaymentAccessClient,
  markSentManuallyClient,
} from "@/lib/db/payment-access-client";

export interface UsePaymentAccessState {
  request:    PaymentAccessRequestRow | null;
  loading:    boolean;
  error:      string | null;
  saving:     boolean;
  saveError:  string | null;
  approve:    (type: AccessType) => Promise<void>;
  reject:     () => Promise<void>;
  markManual: () => Promise<void>;
}

export function usePaymentAccess(requestId: string): UsePaymentAccessState {
  const [request,   setRequest]   = useState<PaymentAccessRequestRow | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [saving,    setSaving]    = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!requestId) { setLoading(false); return; }
    void getRequestByIdClient(requestId).then((result) => {
      if (result.error) setError(result.error);
      else              setRequest(result.data);
      setLoading(false);
    });
  }, [requestId]);

  const approve = useCallback(async (type: AccessType) => {
    setSaving(true);
    setSaveError(null);
    const result = await approvePaymentAccessClient(requestId, type);
    if (result.error) setSaveError(result.error);
    else              setRequest(result.data);
    setSaving(false);
  }, [requestId]);

  const reject = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    const result = await rejectPaymentAccessClient(requestId);
    if (result.error) setSaveError(result.error);
    else              setRequest(result.data);
    setSaving(false);
  }, [requestId]);

  const markManual = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    const result = await markSentManuallyClient(requestId);
    if (result.error) setSaveError(result.error);
    else              setRequest(result.data);
    setSaving(false);
  }, [requestId]);

  return { request, loading, error, saving, saveError, approve, reject, markManual };
}
