"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState, useCallback } from "react";
import { type EvidenceFileRow } from "@/lib/supabase/types";
import { getEvidenceFilesClient } from "@/lib/db/evidence-client";

export interface UseEvidenceState {
  files:   EvidenceFileRow[];
  loading: boolean;
  error:   string | null;
  refresh: () => void;
  addFile: (file: EvidenceFileRow) => void;
  removeFile: (id: string) => void;
}

export function useEvidence(caseId: string): UseEvidenceState {
  const [files,   setFiles]   = useState<EvidenceFileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) { setLoading(false); return; }
    const result = await getEvidenceFilesClient(caseId);
    if (result.error) setError(result.error);
    else              setFiles(result.data ?? []);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { void load(); }, [load]);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    void load();
  }, [load]);

  const addFile = useCallback((file: EvidenceFileRow) => {
    setFiles((prev) => [file, ...prev]);
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  return { files, loading, error, refresh, addFile, removeFile };
}
