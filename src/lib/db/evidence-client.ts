/**
 * Client-side evidence CRUD + Supabase Storage uploads.
 * Falls back to an in-memory mock store when Supabase is not configured.
 */

import { isSupabaseConfigured } from "@/lib/supabase/client";
import { type EvidenceFileRow, type EvidenceType } from "@/lib/supabase/types";
import { ok, fail, type DbResult } from "./result";
import { mockUploadedEvidence } from "@/lib/mock-legal-data";

// ─── Constants ────────────────────────────────────────────────────────────────

export const ALLOWED_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg"] as const;
export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
];
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
// Must match the private bucket documented in the Supabase deployment schema.
export const STORAGE_BUCKET = "evidence-files";

// ─── File validation ──────────────────────────────────────────────────────────

export function validateEvidenceFile(file: File): string | null {
  if (file.size > MAX_FILE_SIZE) {
    return `File is too large. Maximum size is 10 MB (your file: ${(file.size / 1024 / 1024).toFixed(1)} MB).`;
  }
  const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext as typeof ALLOWED_EXTENSIONS[number])) {
    return `Invalid file type "${ext}". Allowed: PDF, PNG, JPG, JPEG.`;
  }
  return null;
}

export function getFileTypeLabel(filename: string): string {
  return (filename.split(".").pop() ?? "").toUpperCase();
}

export function formatFileSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ─── Mock store (seeded from mock-legal-data) ─────────────────────────────────

let _mockStore: Record<string, EvidenceFileRow[]> | null = null;

function initMockStore(): Record<string, EvidenceFileRow[]> {
  const store: Record<string, EvidenceFileRow[]> = {};
  for (const [caseId, uploads] of Object.entries(mockUploadedEvidence)) {
    store[caseId] = uploads.map((u) => ({
      id:              `mock-ev-${caseId}-${u.typeId}`,
      case_id:         caseId,
      file_name:       u.fileName,
      file_type:       getFileTypeLabel(u.fileName),
      file_url:        null,
      file_size_bytes: null,
      evidence_type:   u.typeId as EvidenceType,
      uploaded_at:     new Date(Date.now() - Math.random() * 1e10).toISOString(),
      object_path: null, description: null, document_date: null, is_internal: true,
      archived_at: null, archived_by: null, retention_until: null, content_sha256: null,
    }));
  }
  return store;
}

function getMockStore(): Record<string, EvidenceFileRow[]> {
  if (!_mockStore) _mockStore = initMockStore();
  return _mockStore;
}

function mockListForCase(caseId: string): EvidenceFileRow[] {
  const store = getMockStore();
  if (!store[caseId]) store[caseId] = [];
  return store[caseId];
}

// ─── getEvidenceFilesClient ───────────────────────────────────────────────────

export async function getEvidenceFilesClient(
  caseId: string
): Promise<DbResult<EvidenceFileRow[]>> {
  if (!isSupabaseConfigured) {
    return ok([...mockListForCase(caseId)]);
  }

  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/evidence`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as { files?: EvidenceFileRow[]; error?: string };
  if (!response.ok || !payload.files) return fail(payload.error ?? "Unable to load evidence.");
  return ok(payload.files);
}

/** Lists the current owner's evidence files for reporting and document summaries. */
export async function getAllEvidenceFilesClient(): Promise<DbResult<EvidenceFileRow[]>> {
  if (!isSupabaseConfigured) {
    return ok(Object.values(getMockStore()).flatMap((files) => [...files]));
  }

  return fail("Load evidence through its case-scoped route.");
}

// ─── uploadEvidenceFileClient ─────────────────────────────────────────────────

export async function uploadEvidenceFileClient(
  file: File,
  caseId: string,
  evidenceType: EvidenceType,
  onProgress?: (pct: number) => void,
  metadata: { description?: string; documentDate?: string; isInternal?: boolean } = {}
): Promise<DbResult<EvidenceFileRow>> {
  // Validate
  const validationError = validateEvidenceFile(file);
  if (validationError) return fail(validationError);

  onProgress?.(10);

  if (!isSupabaseConfigured) {
    // Simulate upload delay and progress
    await new Promise((r) => setTimeout(r, 600));
    onProgress?.(60);
    await new Promise((r) => setTimeout(r, 400));
    onProgress?.(100);

    const newRow: EvidenceFileRow = {
      id:              `mock-ev-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      case_id:         caseId,
      file_name:       file.name,
      file_type:       getFileTypeLabel(file.name),
      file_url:        null,
      file_size_bytes: file.size,
      evidence_type:   evidenceType,
      uploaded_at:     new Date().toISOString(),
      object_path: null, description: metadata.description?.trim() || null, document_date: metadata.documentDate || null,
      is_internal: metadata.isInternal !== false, archived_at: null, archived_by: null, retention_until: null, content_sha256: null,
    };
    mockListForCase(caseId).unshift(newRow);
    return ok(newRow);
  }

  const form = new FormData(); form.set("file", file); form.set("evidenceType", evidenceType);
  if (metadata.description?.trim()) form.set("description", metadata.description.trim());
  if (metadata.documentDate) form.set("documentDate", metadata.documentDate);
  form.set("isInternal", String(metadata.isInternal !== false));
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/evidence`, { method: "POST", body: form });
  const payload = await response.json().catch(() => ({})) as { file?: EvidenceFileRow; error?: string };
  if (!response.ok || !payload.file) { onProgress?.(0); return fail(payload.error ?? "Evidence upload failed."); }
  onProgress?.(100); return ok(payload.file);
}

// ─── deleteEvidenceFileClient ─────────────────────────────────────────────────

export async function deleteEvidenceFileClient(
  id: string,
  filePath: string | null
): Promise<DbResult<void>> {
  if (!isSupabaseConfigured) {
    // Remove from mock store
    const store = getMockStore();
    for (const caseId of Object.keys(store)) {
      store[caseId] = store[caseId].filter((r) => r.id !== id);
    }
    return ok(undefined);
  }

  void filePath;
  return fail("Use the case-scoped evidence archive route.");
}

// ─── getSignedUrl ─────────────────────────────────────────────────────────────

export async function getEvidenceAccessUrl(caseId: string, evidenceId: string, mode: "preview" | "download"): Promise<DbResult<string>> {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/evidence/${encodeURIComponent(evidenceId)}?mode=${mode}`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as { url?: string; error?: string };
  return response.ok && payload.url ? ok(payload.url) : fail(payload.error ?? "Unable to access evidence.");
}

export async function archiveEvidenceFileClient(caseId: string, evidenceId: string): Promise<DbResult<void>> {
  if (!isSupabaseConfigured) return deleteEvidenceFileClient(evidenceId, null);
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/evidence/${encodeURIComponent(evidenceId)}`, { method: "DELETE" });
  if (!response.ok) { const payload = await response.json().catch(() => ({})) as { error?: string }; return fail(payload.error ?? "Unable to archive evidence."); }
  return ok(undefined);
}
