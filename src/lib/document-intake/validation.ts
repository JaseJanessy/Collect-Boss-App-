import { createHash } from "node:crypto";
import { z } from "zod";
import {
  configuredPdfIntakeLimits,
  inspectPdfBytes,
  validatePdfFileMetadata,
} from "../../../shared/pdf-intake";
import {
  configuredImageIntakeLimits,
  inspectImageBytes,
  validateImageDimensions,
} from "../../../shared/image-intake";
import { transactionNatures, transactionStatuses } from "./review";

export const DOCUMENT_EVIDENCE_BUCKET = "transaction-evidence";
export const DOCUMENT_EVIDENCE_URL_TTL_SECONDS = 60;
export const DOCUMENT_PDF_LIMITS = configuredPdfIntakeLimits({
  maxBytes: process.env.DOCUMENT_PDF_MAX_BYTES,
  maxPages: process.env.DOCUMENT_PDF_MAX_PAGES,
});
export const MAX_DOCUMENT_EVIDENCE_BYTES = DOCUMENT_PDF_LIMITS.maxBytes;
export const MAX_DOCUMENT_EVIDENCE_PAGES = DOCUMENT_PDF_LIMITS.maxPages;
export const DOCUMENT_IMAGE_LIMITS = configuredImageIntakeLimits({
  maxBytes: process.env.DOCUMENT_IMAGE_MAX_BYTES,
  maxWidth: process.env.DOCUMENT_IMAGE_MAX_WIDTH,
  maxHeight: process.env.DOCUMENT_IMAGE_MAX_HEIGHT,
  minReadableWidth: process.env.DOCUMENT_IMAGE_MIN_READABLE_WIDTH,
  minReadableHeight: process.env.DOCUMENT_IMAGE_MIN_READABLE_HEIGHT,
});

export const documentKinds = [
  "online_bank_transfer_receipt",
  "transaction_screenshot",
  "bank_in_cash_deposit_receipt",
  "payment_receipt",
  "unknown_or_other",
  "invoice",
  "receipt",
  "payment_proof",
  "bank_statement",
  "contract",
  "purchase_order",
  "delivery_order",
  "credit_note",
  "communication_record",
  "communication_evidence",
  "other",
] as const;

export const createDocumentIntakeSchema = z.object({
  source: z.enum(["web_upload", "mobile_upload", "api", "email_import"]),
  intendedWorkflow: z.enum(["transaction_evidence", "payment_evidence", "general_document"]),
}).strict();

export const documentFinaliseSchema = z.object({ action: z.literal("finalise") }).strict();
export const documentActionSchema = documentFinaliseSchema;

const reviewChoiceSchema = z.object({
  mode: z.enum(["candidate", "manual"]),
  candidateId: z.string().trim().max(100).optional(),
  value: z.string().trim().max(255).optional(),
  reason: z.string().trim().max(500).optional(),
}).strict();

const amountReviewChoiceSchema = z.object({
  mode: z.enum(["candidate", "manual"]),
  candidateId: z.string().trim().max(100).optional(),
  amountMinor: z.number().int().safe().optional(),
  recognizedValue: z.string().trim().max(255).optional(),
  reason: z.string().trim().max(500).optional(),
}).strict();

const dateReviewChoiceSchema = reviewChoiceSchema.extend({
  interpretedDateTime: z.string().trim().max(100).optional(),
  timezone: z.string().trim().max(100).optional(),
  confirmed: z.boolean().optional(),
}).strict();

export const documentReviewInputSchema = z.object({
  documentKind: z.enum(documentKinds).nullable().optional(),
  documentKindReason: z.string().trim().max(500).nullable().optional(),
  representsFinancialMovement: z.boolean().nullable().optional(),
  amount: amountReviewChoiceSchema.nullable().optional(),
  currency: z.string().trim().max(3).nullable().optional(),
  currencyConfirmed: z.boolean().optional(),
  date: dateReviewChoiceSchema.nullable().optional(),
  reference: reviewChoiceSchema.nullable().optional(),
  bank: reviewChoiceSchema.nullable().optional(),
  sender: reviewChoiceSchema.nullable().optional(),
  recipient: reviewChoiceSchema.nullable().optional(),
  transactionStatus: z.enum(transactionStatuses).nullable().optional(),
  transactionNature: z.enum(transactionNatures).nullable().optional(),
  transactionNatureNote: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).strict();

export const documentReviewActionSchema = z.object({
  action: z.enum(["save_draft", "confirm"]),
  review: documentReviewInputSchema,
}).strict();

export const uploadMetadataSchema = z.object({
  documentKind: z.enum(documentKinds),
  uploadSource: z.enum(["web_upload", "mobile_upload", "api", "email_import"]),
  evidenceSource: z.enum(["pdf", "screenshot", "bank_in_receipt", "other_image"]),
  rotationDegrees: z.enum(["0", "90", "180", "270"]).transform(Number),
  cropInsetPercent: z.enum(["0", "5"]).transform(Number),
}).strict();

export function validateDocumentUpload(file: File, bytes: Uint8Array):
  | { category: "pdf"; extension: "pdf"; sha256: string; magicMimeType: "application/pdf"; originalFilename: string; pageCount: number | null; pdfVersion: string; imageWidth: null; imageHeight: null }
  | { category: "image"; extension: "jpg" | "png" | "heic"; sha256: string; magicMimeType: "image/jpeg" | "image/png" | "image/heic"; originalFilename: string; pageCount: null; imageWidth: number | null; imageHeight: number | null }
  | { error: string; code: string } {
  const originalFilename = file.name.split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001f\u007f]/g, "").trim() ?? "";
  if (!originalFilename || originalFilename.length > 255) return { error: "The original filename is invalid.", code: "INVALID_FILENAME" };
  if (bytes.length !== file.size || bytes.length <= 0) return { error: "The selected file could not be read.", code: "FILE_UNREADABLE" };
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    const metadataError = validatePdfFileMetadata({ name: originalFilename, mimeType: file.type, size: file.size, limits: DOCUMENT_PDF_LIMITS });
    if (metadataError && !metadataError.valid) return { error: metadataError.message, code: metadataError.code };
    const inspection = inspectPdfBytes(bytes, DOCUMENT_PDF_LIMITS);
    if (!inspection.valid) return { error: inspection.message, code: inspection.code };
    return { category: "pdf", extension: "pdf", sha256, magicMimeType: "application/pdf", originalFilename,
      pageCount: inspection.pageCount, pdfVersion: inspection.pdfVersion, imageWidth: null, imageHeight: null };
  }
  if (file.size > DOCUMENT_IMAGE_LIMITS.maxBytes) return { error: "The selected image is too large.", code: "IMAGE_TOO_LARGE" };
  const image = inspectImageBytes(bytes);
  if (!image) return { error: "Only PDF, PNG, JPEG, and HEIC files are supported.", code: "FILE_TYPE_UNSUPPORTED" };
  const extension = originalFilename.toLowerCase().match(/\.([a-z0-9]+)$/u)?.[1] ?? "";
  const validExtension = image.extension === "jpg" ? ["jpg", "jpeg"].includes(extension) : extension === image.extension;
  const declared = file.type.toLowerCase() === "image/heif" ? "image/heic" : file.type.toLowerCase();
  if (!validExtension || declared !== image.mimeType) return { error: "The image type does not match its file contents.", code: "IMAGE_TYPE_MISMATCH" };
  if (image.width && image.height) {
    const dimensionError = validateImageDimensions(image.width, image.height, DOCUMENT_IMAGE_LIMITS);
    if (dimensionError) return { error: dimensionError.message, code: dimensionError.code };
  }
  return { category: "image", extension: image.extension, sha256, magicMimeType: image.mimeType, originalFilename,
    pageCount: null, imageWidth: image.width, imageHeight: image.height };
}

export function documentEvidenceObjectPath(input: {
  businessId: string;
  intakeId: string;
  evidenceId: string;
  extension: string;
}) {
  const generatedStorageName = `original.${input.extension}`;
  return {
    generatedStorageName,
    objectPath: `${input.businessId}/${input.intakeId}/${input.evidenceId}/${generatedStorageName}`,
  };
}

export function documentPreviewObjectPath(input: { businessId: string; intakeId: string; evidenceId: string }) {
  const generatedStorageName = "preview.jpg";
  return { generatedStorageName, objectPath: `${input.businessId}/${input.intakeId}/${input.evidenceId}/${generatedStorageName}` };
}

export function readIdempotencyKey(headers: Headers): { key: string } | { error: string; code: string } {
  const key = headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(key)) {
    return { error: "A valid Idempotency-Key header is required.", code: "INVALID_IDEMPOTENCY_KEY" };
  }
  return { key };
}

export function requestDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function correlationId(headers: Headers): string {
  const value = headers.get("x-correlation-id")?.trim();
  return value && z.string().uuid().safeParse(value).success ? value : crypto.randomUUID();
}
