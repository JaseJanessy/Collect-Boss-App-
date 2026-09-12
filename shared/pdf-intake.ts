export const PDF_INTAKE_DEFAULT_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxPages: 100,
} as const;

export type PdfIntakeLimits = {
  maxBytes: number;
  maxPages: number;
};

export type PdfIntakeErrorCode =
  | "PDF_ONLY"
  | "PDF_EMPTY"
  | "PDF_TOO_LARGE"
  | "PDF_TOO_MANY_PAGES"
  | "PDF_ENCRYPTED"
  | "PDF_CORRUPT";

export const PDF_INTAKE_MESSAGES: Record<PdfIntakeErrorCode, string> = {
  PDF_ONLY: "Only PDF files are supported.",
  PDF_EMPTY: "This PDF appears to be corrupted or unreadable.",
  PDF_TOO_LARGE: "The selected PDF is too large.",
  PDF_TOO_MANY_PAGES: "The selected PDF has too many pages.",
  PDF_ENCRYPTED: "This PDF appears to be encrypted or password-protected.",
  PDF_CORRUPT: "This PDF appears to be corrupted or unreadable.",
};

export type PdfIntakeInspection =
  | { valid: true; pageCount: number | null; pdfVersion: string }
  | { valid: false; code: PdfIntakeErrorCode; message: string };

function invalid(code: PdfIntakeErrorCode): PdfIntakeInspection {
  return { valid: false, code, message: PDF_INTAKE_MESSAGES[code] };
}

function ascii(bytes: Uint8Array): string {
  let output = "";
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    const chunk = bytes.subarray(offset, Math.min(offset + 8_192, bytes.length));
    output += String.fromCharCode(...chunk);
  }
  return output;
}

export function configuredPdfIntakeLimits(input: {
  maxBytes?: string | number | null;
  maxPages?: string | number | null;
} = {}): PdfIntakeLimits {
  const bytes = Number(input.maxBytes);
  const pages = Number(input.maxPages);
  return {
    // The private storage bucket has a 10 MB hard ceiling. Deployments may
    // lower the application limit without creating a client/storage mismatch.
    maxBytes: Number.isSafeInteger(bytes) && bytes > 0 ? Math.min(bytes, PDF_INTAKE_DEFAULT_LIMITS.maxBytes) : PDF_INTAKE_DEFAULT_LIMITS.maxBytes,
    maxPages: Number.isSafeInteger(pages) && pages > 0 ? pages : PDF_INTAKE_DEFAULT_LIMITS.maxPages,
  };
}

export function validatePdfFileMetadata(input: {
  name: string;
  mimeType: string;
  size: number;
  limits?: PdfIntakeLimits;
}): PdfIntakeInspection | null {
  const limits = input.limits ?? PDF_INTAKE_DEFAULT_LIMITS;
  if (!input.name.trim().toLowerCase().endsWith(".pdf") || input.mimeType.trim().toLowerCase() !== "application/pdf") {
    return invalid("PDF_ONLY");
  }
  if (!Number.isSafeInteger(input.size) || input.size <= 0) return invalid("PDF_EMPTY");
  if (input.size > limits.maxBytes) return invalid("PDF_TOO_LARGE");
  return null;
}

/**
 * Lightweight, dependency-free structural validation for first-release intake.
 * It accepts classic xref tables and PDF 1.5+ xref streams. Page count is best
 * effort because compressed object streams may hide page dictionaries.
 */
export function inspectPdfBytes(bytes: Uint8Array, limits: PdfIntakeLimits = PDF_INTAKE_DEFAULT_LIMITS): PdfIntakeInspection {
  if (!bytes.length) return invalid("PDF_EMPTY");
  if (bytes.length > limits.maxBytes) return invalid("PDF_TOO_LARGE");

  const header = ascii(bytes.subarray(0, Math.min(bytes.length, 16)));
  const version = header.match(/^%PDF-(1\.[0-7]|2\.0)(?:\r|\n|\r\n|[^0-9])/u)?.[1];
  if (!version) return invalid("PDF_CORRUPT");

  const source = ascii(bytes);
  if (/\/Encrypt\b/u.test(source) || /\/Filter\s*\/Standard\b/u.test(source)) {
    return invalid("PDF_ENCRYPTED");
  }

  const eof = source.lastIndexOf("%%EOF");
  if (eof < 0 || source.length - eof > 4_096) return invalid("PDF_CORRUPT");
  const tail = source.slice(Math.max(0, eof - 256), eof + 5);
  const startXref = tail.match(/startxref\s+(\d+)\s+%%EOF\s*$/u);
  if (!startXref) return invalid("PDF_CORRUPT");
  const xrefOffset = Number(startXref[1]);
  if (!Number.isSafeInteger(xrefOffset) || xrefOffset < 0 || xrefOffset >= bytes.length) return invalid("PDF_CORRUPT");
  const xrefTarget = source.slice(xrefOffset, Math.min(xrefOffset + 64, source.length));
  if (!/^xref\b/u.test(xrefTarget) && !/^\d+\s+\d+\s+obj\b/u.test(xrefTarget)) return invalid("PDF_CORRUPT");

  const pageCount = [...source.matchAll(/\/Type\s*\/Page\b/gu)].length || null;
  if (pageCount !== null && pageCount > limits.maxPages) return invalid("PDF_TOO_MANY_PAGES");
  return { valid: true, pageCount, pdfVersion: version };
}
