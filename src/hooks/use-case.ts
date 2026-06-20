"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState, useCallback } from "react";
import { type CaseRow } from "@/lib/supabase/types";
import { getCaseByIdClient } from "@/lib/db/cases-client";

export interface UseCaseState {
  caseData: CaseRow | null;
  loading:  boolean;
  error:    string | null;
  refresh:  () => void;
  update:   (updated: CaseRow) => void;
}

export function useCase(id: string): UseCaseState {
  const [caseData, setCaseData] = useState<CaseRow | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) { setLoading(false); return; }
    const result = await getCaseByIdClient(id);
    if (result.error) setError(result.error);
    else              setCaseData(result.data);
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    void load();
  }, [load]);

  return { caseData, loading, error, refresh, update: setCaseData };
}
