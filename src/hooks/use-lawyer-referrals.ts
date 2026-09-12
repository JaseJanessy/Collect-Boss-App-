"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState, useCallback } from "react";
import { type LawyerReferralRow } from "@/lib/supabase/types";
import { getReferralsByCaseClient, type ProfessionalLegalHandoff } from "@/lib/db/lawyer-referrals-client";

export interface UseLawyerReferralsState {
  referrals:    ProfessionalLegalHandoff[];
  latest:       ProfessionalLegalHandoff | null;
  loading:      boolean;
  error:        string | null;
  refresh:      () => void;
  addReferral:  (r: LawyerReferralRow) => void;
}

export function useLawyerReferrals(caseId: string, enabled = true): UseLawyerReferralsState {
  const [referrals, setReferrals] = useState<ProfessionalLegalHandoff[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    if (!caseId) { setLoading(false); return; }
    const result = await getReferralsByCaseClient(caseId);
    if (result.error) setError(result.error);
    else              setReferrals(result.data ?? []);
    setLoading(false);
  }, [caseId, enabled]);

  useEffect(() => { if (enabled) void load(); }, [enabled, load]);

  const addReferral = useCallback((r: LawyerReferralRow) => {
    setReferrals((prev) => [{ ...r, events: [], documentRequests: [] }, ...prev]);
  }, []);

  const latest = referrals[0] ?? null;

  return { referrals, latest, loading, error, refresh: load, addReferral };
}
