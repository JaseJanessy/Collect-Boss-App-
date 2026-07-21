"use client";

import { useCallback, useEffect, useState } from "react";
import { type EvidenceFileRow } from "@/lib/supabase/types";
import { getAllEvidenceFilesClient } from "@/lib/db/evidence-client";

export function useAllEvidence() {
  const [files, setFiles] = useState<EvidenceFileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await getAllEvidenceFilesClient();
    setFiles(result.data ?? []);
    setError(result.error ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void getAllEvidenceFilesClient().then((result) => {
      if (cancelled) return;
      setFiles(result.data ?? []);
      setError(result.error ?? null);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, []);

  return { files, loading, error, refresh };
}
