"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState, useCallback } from "react";
import { type CaseRow } from "@/lib/supabase/types";
import { getCasesClient } from "@/lib/db/cases-client";

export interface UseCasesState {
  cases:   CaseRow[];
  loading: boolean;
  error:   string | null;
  refresh: () => void;
}

export function useCases(): UseCasesState {
  const [cases,   setCases]   = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await getCasesClient();
    setCases(result.data ?? []);
    setError(result.error ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    void load();
  }, [load]);

  return { cases, loading, error, refresh };
}
