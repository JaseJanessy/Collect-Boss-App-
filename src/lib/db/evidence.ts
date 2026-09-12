import { isSupabaseConfigured } from "@/lib/supabase/client";
import { getServerClient } from "@/lib/supabase/server-client";
import { type EvidenceFileRow, type EvidenceFileInsert } from "@/lib/supabase/types";
import { ok, fail, type DbResult } from "./result";
import { mockUploadedEvidence } from "@/lib/mock-legal-data";

function mockToRow(caseId: string, u: { typeId: string; fileName: string; fileSize: string; uploadedAt: string }): EvidenceFileRow {
  return {
    id:              `mock-ev-${caseId}-${u.typeId}`,
    case_id:         caseId,
    business_id:     "mock-business",
    intake_id:       null,
    file_name:       u.fileName,
    file_type:       u.fileName.split(".").pop()?.toUpperCase() ?? "PDF",
    file_url:        null,
    file_size_bytes: null,
    evidence_type:   u.typeId as EvidenceFileRow["evidence_type"],
    uploaded_at:     new Date().toISOString(),
    object_path: null, description: null, document_date: null, is_internal: true,
    archived_at: null, archived_by: null, retention_until: null, content_sha256: null,
    page_count: null, evidence_version: 1, is_current: true, scan_status: "clean",
    processing_status: "completed", duplicate_match_status: "none", soft_deleted_at: null,
  };
}

export async function getEvidenceFiles(
  caseId: string
): Promise<DbResult<EvidenceFileRow[]>> {
  if (!isSupabaseConfigured) {
    const uploads = mockUploadedEvidence[caseId] ?? [];
    return ok(uploads.map((u) => mockToRow(caseId, u)));
  }

  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("evidence_files")
    .select("*")
    .eq("case_id", caseId)
    .order("uploaded_at", { ascending: false });

  if (error) return fail(error.message);
  return ok(data ?? []);
}

export async function addEvidenceFile(
  input: EvidenceFileInsert
): Promise<DbResult<EvidenceFileRow>> {
  if (!isSupabaseConfigured) return fail("Supabase not configured");

  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("evidence_files")
    .insert(input)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data);
}

export async function deleteEvidenceFile(
  id: string
): Promise<DbResult<void>> {
  if (!isSupabaseConfigured) return fail("Supabase not configured");

  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const { error } = await client.from("evidence_files").delete().eq("id", id);
  if (error) return fail(error.message);
  return ok(undefined);
}
