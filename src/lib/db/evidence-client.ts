/**
 * Client-side evidence CRUD + Supabase Storage uploads.
 * Falls back to an in-memory mock store when Supabase is not configured.
 */

import { getBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
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
export const STORAGE_BUCKET = "evidence";

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

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("evidence_files")
    .select("*")
    .eq("case_id", caseId)
    .order("uploaded_at", { ascending: false });

  if (error) return fail(error.message);
  return ok((data as EvidenceFileRow[]) ?? []);
}

// ─── uploadEvidenceFileClient ─────────────────────────────────────────────────

export async function uploadEvidenceFileClient(
  file: File,
  caseId: string,
  businessId: string,
  evidenceType: EvidenceType,
  onProgress?: (pct: number) => void
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
    };
    mockListForCase(caseId).unshift(newRow);
    return ok(newRow);
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  // Build storage path
  const ext       = file.name.split(".").pop()?.toLowerCase() ?? "bin";
  const safeName  = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${businessId}/${caseId}/${Date.now()}_${safeName}`;

  onProgress?.(20);

  // Upload to Supabase Storage
  const { error: storageError } = await client.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || `image/${ext}`,
    });

  if (storageError) {
    onProgress?.(0);
    return fail(storageError.message);
  }

  onProgress?.(80);

  // Insert DB record
  const { data, error: dbError } = await client
    .from("evidence_files")
    .insert({
      case_id:         caseId,
      file_name:       file.name,
      file_type:       getFileTypeLabel(file.name),
      file_url:        storagePath,
      file_size_bytes: file.size,
      evidence_type:   evidenceType,
    })
    .select()
    .single();

  if (dbError) {
    // Try to clean up storage if DB insert fails
    await client.storage.from(STORAGE_BUCKET).remove([storagePath]);
    onProgress?.(0);
    return fail(dbError.message);
  }

  onProgress?.(100);
  return ok(data as EvidenceFileRow);
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

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  // Delete storage object first (if we have a path)
  if (filePath) {
    const { error: storageError } = await client.storage
      .from(STORAGE_BUCKET)
      .remove([filePath]);
    if (storageError) {
      console.warn("[evidence] Storage delete failed:", storageError.message);
    }
  }

  // Delete DB record
  const { error } = await client.from("evidence_files").delete().eq("id", id);
  if (error) return fail(error.message);
  return ok(undefined);
}

// ─── getSignedUrl ─────────────────────────────────────────────────────────────

export async function getSignedUrl(filePath: string): Promise<string | null> {
  if (!isSupabaseConfigured || !filePath) return null;

  const client = getBrowserClient();
  if (!client) return null;

  const { data } = await client.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(filePath, 3600); // 1 hour

  return data?.signedUrl ?? null;
}
