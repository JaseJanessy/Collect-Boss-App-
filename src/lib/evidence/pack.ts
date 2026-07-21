import type { EvidenceFileRow } from "@/lib/supabase/types";

export const MAX_EVIDENCE_PACK_FILES = 50;
export const MAX_EVIDENCE_PACK_BYTES = 50 * 1024 * 1024;

export interface EvidencePackManifestEntry {
  evidenceId: string;
  filename: string;
  contentType: string;
  sizeBytes: number | null;
  sha256: string | null;
  uploadedAt: string;
  documentDate: string | null;
}

export interface EvidencePackManifest {
  version: 1;
  caseId: string;
  generatedAt: string;
  files: EvidencePackManifestEntry[];
}

export function sanitizeEvidencePackFilename(value: string, fallback: string): string {
  const normalized = value.normalize("NFKC")
    .replace(/[\\/]+/g, "_")
    .replace(/[\u0000-\u001F\u007F]/g, "_")
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/^\.+/, "")
    .replace(/_+/g, "_")
    .trim()
    .slice(0, 120);
  return normalized && normalized !== "." && normalized !== ".." ? normalized : fallback;
}

export function sortEvidenceForPack(files: EvidenceFileRow[]): EvidenceFileRow[] {
  return [...files].sort((left, right) =>
    left.uploaded_at.localeCompare(right.uploaded_at) || left.id.localeCompare(right.id)
  );
}

export function buildEvidencePackManifest(caseId: string, files: EvidenceFileRow[], generatedAt: string): EvidencePackManifest {
  const filenameCounts = new Map<string, number>();
  const entries = sortEvidenceForPack(files).map((file, index) => {
    const base = sanitizeEvidencePackFilename(file.file_name, `evidence-${index + 1}.${file.file_type.toLowerCase()}`);
    const seen = (filenameCounts.get(base) ?? 0) + 1;
    filenameCounts.set(base, seen);
    const filename = seen === 1 ? base : `${base.slice(0, 110)}-${seen}`;
    return {
      evidenceId: file.id,
      filename,
      contentType: file.file_type.toLowerCase(),
      sizeBytes: file.file_size_bytes,
      sha256: file.content_sha256,
      uploadedAt: file.uploaded_at,
      documentDate: file.document_date,
    };
  });

  return { version: 1, caseId, generatedAt, files: entries };
}

export function validateEvidencePackSelection(files: EvidenceFileRow[]): string | null {
  if (files.length > MAX_EVIDENCE_PACK_FILES) return `Select no more than ${MAX_EVIDENCE_PACK_FILES} evidence files.`;
  const bytes = files.reduce((total, file) => total + (file.file_size_bytes ?? 0), 0);
  if (bytes > MAX_EVIDENCE_PACK_BYTES) return "Selected evidence exceeds the 50 MB pack limit.";
  return null;
}
