import { createHash } from "node:crypto";

const MAX_PROOF_SIZE = 10 * 1024 * 1024;
const signatures: Record<string, { extension: string; bytes: number[] }> = {
  "application/pdf": { extension: "pdf", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  "image/jpeg": { extension: "jpg", bytes: [0xff, 0xd8, 0xff] },
  "image/png": { extension: "png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
};

export interface ValidatedProof {
  bytes: Uint8Array;
  contentType: "application/pdf" | "image/jpeg" | "image/png";
  extension: "pdf" | "jpg" | "png";
  sha256: string;
}

export async function validatePaymentProof(file: File): Promise<ValidatedProof> {
  const signature = signatures[file.type];
  if (!signature || file.size < signature.bytes.length || file.size > MAX_PROOF_SIZE) {
    throw new Error("Proof must be a PDF, JPG, or PNG under 10 MB.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!signature.bytes.every((byte, index) => bytes[index] === byte)) {
    throw new Error("Proof file content does not match its declared type.");
  }
  return {
    bytes,
    contentType: file.type as ValidatedProof["contentType"],
    extension: signature.extension as ValidatedProof["extension"],
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function validatePaymentDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Enter a valid payment date.");
  const date = new Date(`${value}T00:00:00.000Z`);
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const oldest = new Date(today); oldest.setUTCFullYear(oldest.getUTCFullYear() - 10);
  if (Number.isNaN(date.valueOf()) || date > today || date < oldest) throw new Error("Enter a valid payment date.");
  return value;
}
