"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState, useCallback, useRef } from "react";
import { type CaseRow } from "@/lib/supabase/types";
import { getCasesClient, type CaseListOptions } from "@/lib/db/cases-client";

export interface UseCasesState {
  cases:   CaseRow[];
  loading: boolean;
  loadingMore: boolean;
  error:   string | null;
  total: number;
  hasMore: boolean;
  refresh: () => void;
  loadMore: () => void;
}

export function useCases(options: Omit<CaseListOptions, "page" | "perPage"> = {}): UseCasesState {
  const {
    query = "", statuses = [], priorities = [], owner, agingMin, agingMax,
    promiseMissed, plan, dispute, dueToday, highValueMinor, closed,
  } = options;
  const statusesKey = statuses.join(",");
  const prioritiesKey = priorities.join(",");
  const [cases,   setCases]   = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const requestVersion = useRef(0);

  const load = useCallback(async (requestedPage: number, append: boolean) => {
    const version = ++requestVersion.current;
    if (append) setLoadingMore(true);
    else setLoading(true);

    const result = await getCasesClient({
      page: requestedPage,
      query,
      statuses: statusesKey ? statusesKey.split(",") as CaseListOptions["statuses"] : [],
      priorities: prioritiesKey ? prioritiesKey.split(",") as CaseListOptions["priorities"] : [],
      owner, agingMin, agingMax,
      promiseMissed, plan, dispute, dueToday, highValueMinor, closed,
    });
    if (version !== requestVersion.current) return;

    if (result.data) {
      setCases((current) => append ? [...current, ...result.data.cases] : result.data.cases);
      setPage(result.data.page);
      setTotal(result.data.total);
      setError(null);
    } else {
      setError(result.error ?? "Failed to load cases.");
    }
    setLoading(false);
    setLoadingMore(false);
  }, [
    query, statusesKey, prioritiesKey, owner, agingMin, agingMax,
    promiseMissed, plan, dispute, dueToday, highValueMinor, closed,
  ]);

  useEffect(() => {
    void load(1, false);
    return () => { requestVersion.current += 1; };
  }, [load]);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    void load(1, false);
  }, [load]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || cases.length >= total) return;
    void load(page + 1, true);
  }, [cases.length, load, loading, loadingMore, page, total]);

  return { cases, loading, loadingMore, error, total, hasMore: cases.length < total, refresh, loadMore };
}
