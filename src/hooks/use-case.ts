"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState, useCallback, useRef } from "react";
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
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    if (!id) {
      setCaseData(null);
      setError("Invalid case ID.");
      setLoading(false);
      return;
    }
    const result = await getCaseByIdClient(id);
    if (version !== requestVersion.current) return;
    if (result.error) {
      setCaseData(null);
      setError(result.error);
    } else {
      setCaseData(result.data ?? null);
      setError(null);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
    return () => { requestVersion.current += 1; };
  }, [load]);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    void load();
  }, [load]);

  return { caseData, loading, error, refresh, update: setCaseData };
}
