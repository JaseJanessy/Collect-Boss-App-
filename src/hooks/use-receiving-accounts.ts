"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState, useCallback } from "react";
import { type ReceivingAccountRow, type ReceivingAccountUpdate } from "@/lib/supabase/types";
import {
  getReceivingAccountsClient,
  updateReceivingAccountClient,
  deleteReceivingAccountClient,
  saveReceivingAccountClient,
  setPrimaryAccountClient,
} from "@/lib/db/receiving-accounts-client";
import { useBusinessId } from "@/hooks/use-business-id";

export interface UseReceivingAccountsState {
  accounts:      ReceivingAccountRow[];
  loading:       boolean;
  error:         string | null;
  refresh:       () => void;
  addAccount:    (row: ReceivingAccountRow) => void;
  patchAccount:  (id: string, patch: ReceivingAccountUpdate) => void;
  removeAccount: (id: string) => void;
}

export function useReceivingAccounts(): UseReceivingAccountsState {
  const businessId = useBusinessId();
  const [accounts, setAccounts] = useState<ReceivingAccountRow[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getReceivingAccountsClient(businessId ?? undefined);
    if (result.error) setError(result.error);
    else              setAccounts(result.data ?? []);
    setLoading(false);
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const addAccount    = useCallback((row: ReceivingAccountRow) => {
    setAccounts((prev) => [...prev, row]);
  }, []);

  const patchAccount  = useCallback((id: string, patch: ReceivingAccountUpdate) => {
    setAccounts((prev) => {
      const next = prev.map((a) => (a.id === id ? { ...a, ...patch } : a));
      if (patch.is_primary) {
        return next.map((a) => (a.id === id ? a : { ...a, is_primary: false }));
      }
      return next;
    });
  }, []);

  const removeAccount = useCallback((id: string) => {
    setAccounts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return { accounts, loading, error, refresh: load, addAccount, patchAccount, removeAccount };
}
