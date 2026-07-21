import { createHash, randomUUID } from "node:crypto";

export const EVIDENCE_BUCKET = "evidence-files";
export const MAX_EVIDENCE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_EVIDENCE_FILES_PER_CASE = 50;
export const EVIDENCE_RETENTION_YEARS = 7;

const allowed = new Map([
  ["application/pdf", "pdf"],
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
]);

export function validateEvidenceUpload(file: File, bytes: Uint8Array): { extension: string; sha256: string } | { error: string } {
  if (!file.name || file.name.length > 255) return { error: "Invalid file name." };
  if (file.size <= 0 || file.size > MAX_EVIDENCE_FILE_BYTES) return { error: "Evidence files must be between 1 byte and 10 MB." };
  const extension = allowed.get(file.type);
  if (!extension) return { error: "Only PDF, PNG, and JPEG evidence files are supported." };
  const isPdf = bytes.length >= 5 && new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  const isPng = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!isPdf && !isPng && !isJpeg) return { error: "The file contents do not match the selected evidence type." };
  return { extension, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export function createEvidenceObjectPath(businessId: string, caseId: string, extension: string): string {
  return `${businessId}/${caseId}/${randomUUID()}.${extension}`;
}

export function retentionDate(): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() + EVIDENCE_RETENTION_YEARS);
  return date.toISOString().slice(0, 10);
}
