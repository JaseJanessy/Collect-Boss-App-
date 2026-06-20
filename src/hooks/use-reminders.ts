"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState, useCallback } from "react";
import { type ReminderRow, type ReminderStatus } from "@/lib/supabase/types";
import { getRemindersClient, updateReminderStatusClient } from "@/lib/db/reminders-client";

export interface UseRemindersState {
  reminders:    ReminderRow[];
  loading:      boolean;
  error:        string | null;
  refresh:      () => void;
  addReminder:  (r: ReminderRow) => void;
  updateStatus: (id: string, status: ReminderStatus) => void;
}

export function useReminders(caseId: string): UseRemindersState {
  const [reminders, setReminders] = useState<ReminderRow[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) { setLoading(false); return; }
    const result = await getRemindersClient(caseId);
    if (result.error) setError(result.error);
    else              setReminders(result.data ?? []);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { void load(); }, [load]);

  const addReminder = useCallback((r: ReminderRow) => {
    setReminders((prev) => [r, ...prev]);
  }, []);

  const updateStatus = useCallback(async (id: string, status: ReminderStatus) => {
    setReminders((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status } : r))
    );
    await updateReminderStatusClient(id, status);
  }, []);

  return { reminders, loading, error, refresh: load, addReminder, updateStatus };
}
