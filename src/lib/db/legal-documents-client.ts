/**
 * Client-side legal documents CRUD.
 * Falls back to in-memory mock store when Supabase is not configured.
 */

import { getBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  type LegalDocumentRow,
  type LegalDocumentInsert,
  type LegalDocType,
} from "@/lib/supabase/types";
import { ok, fail, type DbResult } from "./result";

// ─── Mock store ───────────────────────────────────────────────────────────────

const _mockStore: LegalDocumentRow[] = [];

function mockId(): string {
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
}

// ─── getLegalDocsByCaseClient ─────────────────────────────────────────────────

export async function getLegalDocsByCaseClient(
  caseId: string
): Promise<DbResult<LegalDocumentRow[]>> {
  if (!isSupabaseConfigured) {
    return ok(_mockStore.filter((d) => d.case_id === caseId));
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("legal_documents")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });

  if (error) return fail(error.message);
  return ok((data as LegalDocumentRow[]) ?? []);
}

// ─── getEvidencePacksClient ───────────────────────────────────────────────────
// Returns all evidence_pack docs for a business (for the documents index)

export async function getEvidencePacksClient(
  businessId: string
): Promise<DbResult<LegalDocumentRow[]>> {
  if (!isSupabaseConfigured) {
    return ok(_mockStore.filter((d) => d.document_type === "evidence_pack"));
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  // Join via cases.business_id is complex on client — fetch all evidence_packs
  // and let caller filter if needed. For display purposes this is fine.
  const { data, error } = await client
    .from("legal_documents")
    .select("*, cases!inner(business_id)")
    .eq("document_type", "evidence_pack")
    .eq("cases.business_id", businessId)
    .order("created_at", { ascending: false });

  if (error) {
    // Fallback: simpler query without join
    const { data: d2, error: e2 } = await client
      .from("legal_documents")
      .select("*")
      .eq("document_type", "evidence_pack")
      .order("created_at", { ascending: false });
    if (e2) return fail(e2.message);
    return ok((d2 as LegalDocumentRow[]) ?? []);
  }

  return ok((data as LegalDocumentRow[]) ?? []);
}

// ─── saveEvidencePackClient ───────────────────────────────────────────────────

export async function saveEvidencePackClient(input: {
  case_id:      string;
  title:        string;
  content:      string; // JSON metadata blob — NOT the PDF binary
  document_type: LegalDocType;
}): Promise<DbResult<LegalDocumentRow>> {
  const insertPayload: LegalDocumentInsert = {
    case_id:       input.case_id,
    document_type: input.document_type,
    title:         input.title,
    content:       input.content,
    status:        "finalised",
  };

  if (!isSupabaseConfigured) {
    const newRow: LegalDocumentRow = {
      id:            mockId(),
      case_id:       input.case_id,
      document_type: input.document_type,
      title:         input.title,
      content:       input.content,
      status:        "finalised",
      generation_key: null,
      document_number: null,
      template_version: 1,
      issued_at: null,
      issued_by: null,
      snapshot: null,
      sent_at:       null,
      created_at:    new Date().toISOString(),
    };
    _mockStore.unshift(newRow);
    return ok(newRow);
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("legal_documents")
    .insert(insertPayload)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data as LegalDocumentRow);
}
