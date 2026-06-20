"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState, useCallback } from "react";
import { type LawyerReferralRow } from "@/lib/supabase/types";
import { getReferralsByCaseClient } from "@/lib/db/lawyer-referrals-client";

export interface UseLawyerReferralsState {
  referrals:    LawyerReferralRow[];
  latest:       LawyerReferralRow | null;
  loading:      boolean;
  error:        string | null;
  refresh:      () => void;
  addReferral:  (r: LawyerReferralRow) => void;
}

export function useLawyerReferrals(caseId: string): UseLawyerReferralsState {
  const [referrals, setReferrals] = useState<LawyerReferralRow[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) { setLoading(false); return; }
    const result = await getReferralsByCaseClient(caseId);
    if (result.error) setError(result.error);
    else              setReferrals(result.data ?? []);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { void load(); }, [load]);

  const addReferral = useCallback((r: LawyerReferralRow) => {
    setReferrals((prev) => [r, ...prev]);
  }, []);

  const latest = referrals[0] ?? null;

  return { referrals, latest, loading, error, refresh: load, addReferral };
}
