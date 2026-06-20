"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState, useCallback } from "react";
import { type LegalDocumentRow } from "@/lib/supabase/types";
import {
  getLegalDocsByCaseClient,
  saveEvidencePackClient,
} from "@/lib/db/legal-documents-client";

export interface UseLegalDocumentsState {
  docs:      LegalDocumentRow[];
  loading:   boolean;
  error:     string | null;
  refresh:   () => void;
  addDoc:    (doc: LegalDocumentRow) => void;
}

export function useLegalDocuments(caseId: string): UseLegalDocumentsState {
  const [docs,    setDocs]    = useState<LegalDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) { setLoading(false); return; }
    const result = await getLegalDocsByCaseClient(caseId);
    if (result.error) setError(result.error);
    else              setDocs(result.data ?? []);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { void load(); }, [load]);

  const addDoc = useCallback((doc: LegalDocumentRow) => {
    setDocs((prev) => [doc, ...prev]);
  }, []);

  return { docs, loading, error, refresh: load, addDoc };
}
