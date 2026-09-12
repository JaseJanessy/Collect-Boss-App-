import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { File as NativeFile } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';

import { requireSupabase } from '@/lib/supabase';
import {
  configuredPdfIntakeLimits,
  inspectPdfBytes,
  validatePdfFileMetadata,
} from '../../../shared/pdf-intake';
import {
  configuredImageIntakeLimits, inspectImageBytes, validateImageDimensions,
  type ImageEvidenceSource,
} from '../../../shared/image-intake';

type MobileConfig = { apiBaseUrl?: string; pdfMaxBytes?: number; pdfMaxPages?: number; imageMaxBytes?: number; imageMaxWidth?: number; imageMaxHeight?: number };
const config = Constants.expoConfig?.extra as MobileConfig | undefined;
const apiBaseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || config?.apiBaseUrl?.trim() || '').replace(/\/$/, '');
export const MOBILE_PDF_LIMITS = configuredPdfIntakeLimits({
  maxBytes: process.env.EXPO_PUBLIC_PDF_MAX_BYTES ?? config?.pdfMaxBytes,
  maxPages: process.env.EXPO_PUBLIC_PDF_MAX_PAGES ?? config?.pdfMaxPages,
});
export const MOBILE_IMAGE_LIMITS = configuredImageIntakeLimits({
  maxBytes: process.env.EXPO_PUBLIC_IMAGE_MAX_BYTES ?? config?.imageMaxBytes,
  maxWidth: process.env.EXPO_PUBLIC_IMAGE_MAX_WIDTH ?? config?.imageMaxWidth,
  maxHeight: process.env.EXPO_PUBLIC_IMAGE_MAX_HEIGHT ?? config?.imageMaxHeight,
});

export type TransactionIntake = {
  id: string;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type TransactionEvidence = {
  id: string;
  originalFilename: string;
  bytes: number;
  version: number;
  isCurrent: boolean;
  scanStatus: string;
  processingStatus: string;
  duplicateWarning: boolean;
  pageCount: number | null;
  imageWidth: number | null;
  imageHeight: number | null;
  evidenceSource: 'pdf' | ImageEvidenceSource;
  qualityWarnings: string[];
  hasSafePreview: boolean;
  uploadedAt: string;
};

export type TransactionExtraction = {
  id: string;
  evidenceId: string;
  status: 'queued' | 'processing' | 'completed' | 'needs_review' | 'failed' | 'cancelled';
  processingStatus: string;
  documentKind: string | null;
  classificationConfidence: number | null;
  structuredResult: Record<string, unknown> | null;
  warnings: string[];
  provider: string;
  providerModel: string | null;
  providerVersion: string | null;
  parserVersion: string;
  extractionMethod: 'pdf_text_layer' | 'ocr' | null;
  attemptCount: number;
  errorCode: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  extractionVersion: number;
  documentVersion: number;
  candidates: TransactionExtractionCandidate[];
};

export type ReviewExtractionVersion = {
  id: string; evidenceId: string; extractionVersion: number | null; documentVersion: number | null;
  status: string; documentKind: string | null; classificationConfidence: number | null;
  structuredResult: Record<string, unknown> | null; parserVersion: string; provider: string;
  providerModel: string | null; providerVersion: string | null; extractionMethod: string | null; completedAt: string | null;
};

export type ReviewEvidenceLocation = {
  source: 'pdf_text_layer' | 'ocr'; page: number | null; imageId: string | null; snippet: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
};

export type ReviewAmountCandidate = {
  candidateId: string; minorUnits: number; currency: string; label: string; confidence: number;
  recognizedValue: string; evidence: ReviewEvidenceLocation; recommended: boolean;
};

export type ReviewTextCandidate = {
  candidateId: string; value: string; confidence: number; evidence: ReviewEvidenceLocation;
};

export type TransactionReviewWorkspace = {
  extractionId: string | null; evidenceId: string | null; proposedDocumentKind: string | null;
  classificationConfidence: number | null; amountCandidates: ReviewAmountCandidate[];
  dateCandidates: ReviewTextCandidate[]; referenceCandidates: ReviewTextCandidate[]; bankCandidates: ReviewTextCandidate[];
  senderCandidates: ReviewTextCandidate[]; recipientCandidates: ReviewTextCandidate[]; statusCandidates: ReviewTextCandidate[];
  warnings: string[]; recommendedAmountCandidateId: string | null; requiresDocumentKindReview: boolean;
};

export type TransactionReviewData = {
  workspace: TransactionReviewWorkspace;
  currentEvidence: TransactionEvidence | null;
  evidenceVersions: TransactionEvidence[];
  extractionVersions: ReviewExtractionVersion[];
  latestReview: Record<string, unknown> | null;
  reviewVersions: Record<string, unknown>[];
  business: { defaultCurrency: string; timezone: string };
};

export type TransactionReviewInput = {
  documentKind?: string | null; documentKindReason?: string | null; representsFinancialMovement?: boolean | null;
  amount?: { mode: 'candidate' | 'manual'; candidateId?: string; amountMinor?: number; recognizedValue?: string; reason?: string } | null;
  currency?: string | null; currencyConfirmed?: boolean;
  date?: { mode: 'candidate' | 'manual'; candidateId?: string; interpretedDateTime?: string; timezone?: string; confirmed?: boolean; reason?: string } | null;
  reference?: { mode: 'candidate' | 'manual'; candidateId?: string; value?: string; reason?: string } | null;
  bank?: { mode: 'candidate' | 'manual'; candidateId?: string; value?: string; reason?: string } | null;
  sender?: { mode: 'candidate' | 'manual'; candidateId?: string; value?: string; reason?: string } | null;
  recipient?: { mode: 'candidate' | 'manual'; candidateId?: string; value?: string; reason?: string } | null;
  transactionStatus?: 'successful' | 'pending' | 'failed' | 'unknown' | null;
  transactionNature?: 'loan_disbursement' | 'repayment' | 'partial_repayment' | 'refund' | 'deposit' | 'fee_adjustment' | 'other' | null;
  transactionNatureNote?: string | null; notes?: string | null;
};

export type TransactionNature = 'loan_disbursement' | 'repayment' | 'partial_repayment' | 'refund' | 'deposit_or_other' | 'collection_case';
export type TransactionWorkflowData = {
  step: 'ai_result' | 'transaction_nature' | 'profile_match' | 'required_details' | 'duplicate_review' | 'review_create' | 'success';
  expectedVersion: number; transactionNature?: TransactionNature | null; amountMinor?: number | null; currency?: string | null;
  transactionDate?: string | null; reference?: string | null; externalTransactionId?: string | null;
  bank?: string | null; sender?: string | null; recipient?: string | null;
  profileDecision?: { kind: 'existing'; customerId: string } | { kind: 'new'; profile: { debtorType: 'individual' | 'business'; name: string; contactName?: string | null; registrationNo?: string | null; email?: string | null; phone?: string | null; address?: string | null } } | null;
  accountId?: string | null; obligationId?: string | null; caseId?: string | null; originalPaymentId?: string | null;
  dueDate?: string | null; createCollectionCase: boolean; paymentMethod: 'bank_transfer';
  duplicateReview?: { acknowledged: boolean; candidateKeys: string[]; decision: 'continue_separate' | 'link_existing' | 'not_duplicate' } | null;
  notes?: string | null;
};
export type TransactionWorkflow = {
  workflow: { version: number; step: string; data: TransactionWorkflowData; updatedAt: string } | null;
  profileMatches: { customerId: string; confidence: number; reasons: string[]; strongIdentifierMatch: boolean }[];
  duplicateMatches: { candidateKey: string; confidence: 'exact' | 'probable' | 'near'; reasons: string[] }[];
  relatedRecords?: {
    accounts: { id: string; display_name: string; currency: string }[];
    obligations: { id: string; reference: string; currency: string; outstanding_minor: number; due_date: string }[];
    cases: { id: string; invoice_no: string | null; currency: string; outstanding_minor: number }[];
    payments: { id: string; case_id: string; amount_minor: number; currency: string; reference_no: string | null; review_status: string }[];
  };
  outcome: null | { route: TransactionNature; customer_id: string | null; account_id: string | null; obligation_id: string | null; payment_id: string | null; original_payment_id: string | null; case_id: string | null; result: Record<string, unknown>; created_at: string };
};

export type TransactionExtractionCandidate = {
  id: string;
  fieldType: string;
  originalText: string;
  normalizedValue: string | { currency: string; minor_units: number };
  confidence: number;
  validationFlags: string[];
  source: { documentVersion: number; page: number | null; imageId: string | null; snippet: string };
};

export type SelectedTransactionPdf = {
  uri: string;
  name: string;
  mimeType: 'application/pdf';
  size: number;
  sha256: string;
  pageCount: number | null;
  pdfVersion: string;
  evidenceSource: 'pdf';
  rotationDegrees: 0;
  cropInsetPercent: 0;
};

export type SelectedTransactionImage = {
  uri: string; previewUri: string; name: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/heic';
  size: number; sha256: string; width: number; height: number;
  evidenceSource: ImageEvidenceSource;
  rotationDegrees: 0 | 90 | 180 | 270;
  cropInsetPercent: 0 | 5;
};

export type SelectedTransactionEvidence = SelectedTransactionPdf | SelectedTransactionImage;

export type TransactionUploadProgress = { sent: number; total: number; ratio: number | null };

type ApiErrorBody = { error?: string | { code?: string; message?: string; issues?: { message?: string }[] } };

function configuredApiUrl(path: string) {
  if (!apiBaseUrl || !/^https?:\/\//u.test(apiBaseUrl)) throw new Error('The secure upload service is not configured.');
  return `${apiBaseUrl}${path}`;
}

async function bearerToken() {
  const { data, error } = await requireSupabase().auth.getSession();
  if (error || !data.session?.access_token) throw new Error('Your session has expired. Please sign in again.');
  return data.session.access_token;
}

function responseMessage(status: number, body: string) {
  if (status === 401) return 'Your session has expired. Please sign in again.';
  try {
    const parsed = JSON.parse(body) as ApiErrorBody;
    if (typeof parsed.error === 'string') return parsed.error;
    if (parsed.error?.message) {
      const details = parsed.error.issues?.map((issue) => issue.message).filter(Boolean).slice(0, 2).join(' ');
      return details ? `${parsed.error.message} ${details}` : parsed.error.message;
    }
  } catch { /* use the stable fallback */ }
  return 'The upload could not be completed. Please try again.';
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await bearerToken();
  const response = await fetch(configuredApiUrl(path), {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(responseMessage(response.status, body));
  return JSON.parse(body) as T;
}

function digestHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function validateSelectedTransactionPdf(input: {
  uri: string;
  name: string;
  mimeType: string | null | undefined;
  size: number | null | undefined;
}): Promise<SelectedTransactionPdf> {
  const bytes = await new NativeFile(input.uri).bytes();
  const size = input.size ?? bytes.length;
  const metadataError = validatePdfFileMetadata({ name: input.name, mimeType: input.mimeType ?? '', size, limits: MOBILE_PDF_LIMITS });
  if (metadataError && !metadataError.valid) throw new Error(metadataError.message);
  if (bytes.length !== size) throw new Error('This PDF appears to be corrupted or unreadable.');
  const inspection = inspectPdfBytes(bytes, MOBILE_PDF_LIMITS);
  if (!inspection.valid) throw new Error(inspection.message);
  const sha256 = digestHex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes));
  return { uri: input.uri, name: input.name, mimeType: 'application/pdf', size, sha256, pageCount: inspection.pageCount,
    pdfVersion: inspection.pdfVersion, evidenceSource: 'pdf', rotationDegrees: 0, cropInsetPercent: 0 };
}

export async function validateSelectedTransactionImage(input: {
  uri: string; name: string; mimeType: string | null | undefined; size: number | null | undefined;
  width: number; height: number; evidenceSource: ImageEvidenceSource;
}): Promise<SelectedTransactionImage> {
  const bytes = await new NativeFile(input.uri).bytes();
  const size = input.size ?? bytes.length;
  if (size <= 0 || bytes.length !== size) throw new Error('The selected image could not be read.');
  if (size > MOBILE_IMAGE_LIMITS.maxBytes) throw new Error('The selected image is too large.');
  const inspection = inspectImageBytes(bytes);
  if (!inspection) throw new Error('Only PNG, JPEG, and HEIC images are supported.');
  const declared = input.mimeType === 'image/heif' ? 'image/heic' : input.mimeType;
  if (declared && declared !== inspection.mimeType) throw new Error('The image type does not match its file contents.');
  const width = inspection.width ?? input.width; const height = inspection.height ?? input.height;
  const dimensionError = validateImageDimensions(width, height, MOBILE_IMAGE_LIMITS);
  if (dimensionError) throw new Error(dimensionError.message);
  const sha256 = digestHex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes));
  return { uri: input.uri, previewUri: input.uri, name: input.name, mimeType: inspection.mimeType, size, sha256,
    width, height, evidenceSource: input.evidenceSource, rotationDegrees: 0, cropInsetPercent: 0 };
}

export async function listTransactionIntakes(): Promise<TransactionIntake[]> {
  const result = await apiRequest<{ intakes: TransactionIntake[] }>('/api/document-intakes');
  return result.intakes.filter((intake) => !['submitted', 'cancelled'].includes(intake.status));
}

export async function createTransactionIntake(idempotencyKey: string): Promise<TransactionIntake> {
  const result = await apiRequest<{ intake: TransactionIntake }>('/api/document-intakes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ source: 'mobile_upload', intendedWorkflow: 'transaction_evidence' }),
  });
  return result.intake;
}

export async function listTransactionEvidence(intakeId: string): Promise<TransactionEvidence[]> {
  const result = await apiRequest<{ evidence: TransactionEvidence[] }>(`/api/document-intakes/${encodeURIComponent(intakeId)}/evidence`);
  return result.evidence;
}

export async function getTransactionExtraction(intakeId: string): Promise<TransactionExtraction | null> {
  const result = await apiRequest<{ extraction: TransactionExtraction | null; candidates: TransactionExtractionCandidate[] }>(
    `/api/document-intakes/${encodeURIComponent(intakeId)}/extraction`,
  );
  return result.extraction ? { ...result.extraction, candidates: result.candidates ?? [] } : null;
}

export async function getTransactionReview(intakeId: string): Promise<TransactionReviewData> {
  return apiRequest<TransactionReviewData>(`/api/document-intakes/${encodeURIComponent(intakeId)}/review`);
}

export async function saveTransactionReview(input: {
  intakeId: string; action: 'save_draft' | 'confirm'; review: TransactionReviewInput; idempotencyKey: string;
}) {
  return apiRequest<{ review: Record<string, unknown>; readyToSubmit: boolean }>(
    `/api/document-intakes/${encodeURIComponent(input.intakeId)}/review`,
    {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': input.idempotencyKey },
      body: JSON.stringify({ action: input.action, review: input.review }),
    },
  );
}

export async function getTransactionWorkflow(intakeId: string) {
  return apiRequest<TransactionWorkflow>(`/api/document-intakes/${encodeURIComponent(intakeId)}/workflow`);
}

export async function saveTransactionWorkflow(intakeId: string, data: TransactionWorkflowData, idempotencyKey: string) {
  return apiRequest<{ workflow: { version: number; step: string; data: TransactionWorkflowData; updatedAt: string } }>(
    `/api/document-intakes/${encodeURIComponent(intakeId)}/workflow`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(data) },
  );
}

export async function submitTransactionWorkflow(intakeId: string, idempotencyKey: string) {
  return apiRequest<{ outcome: TransactionWorkflow['outcome']; idempotent_replay: boolean }>(
    `/api/document-intakes/${encodeURIComponent(intakeId)}/workflow`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } },
  );
}

export async function retryTransactionExtraction(intakeId: string, idempotencyKey: string): Promise<TransactionExtraction> {
  const result = await apiRequest<{ extraction: Omit<TransactionExtraction, 'candidates'> }>(
    `/api/document-intakes/${encodeURIComponent(intakeId)}/extraction`,
    { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } },
  );
  return { ...result.extraction, candidates: [] };
}

export async function startTransactionPdfUpload(input: {
  intakeId: string;
  selected: SelectedTransactionEvidence;
  idempotencyKey: string;
  replacesEvidenceId?: string;
  onProgress?: (progress: TransactionUploadProgress) => void;
}) {
  const token = await bearerToken();
  const suffix = input.replacesEvidenceId ? `/evidence/${encodeURIComponent(input.replacesEvidenceId)}/replace` : '/evidence';
  const task = FileSystem.createUploadTask(
    configuredApiUrl(`/api/document-intakes/${encodeURIComponent(input.intakeId)}${suffix}`),
    input.selected.uri,
    {
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file', mimeType: input.selected.mimeType, httpMethod: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': input.idempotencyKey },
      parameters: {
        documentKind: input.selected.evidenceSource === 'bank_in_receipt' ? 'receipt'
          : input.selected.evidenceSource === 'screenshot' ? 'payment_proof' : 'other',
        uploadSource: 'mobile_upload', evidenceSource: input.selected.evidenceSource,
        rotationDegrees: String(input.selected.rotationDegrees), cropInsetPercent: String(input.selected.cropInsetPercent),
      },
    },
    ({ totalBytesSent, totalBytesExpectedToSend }) => input.onProgress?.({
      sent: totalBytesSent, total: totalBytesExpectedToSend,
      ratio: totalBytesExpectedToSend > 0 ? totalBytesSent / totalBytesExpectedToSend : null,
    }),
  );
  const promise = task.uploadAsync().then((result) => {
    if (!result) throw new Error('The upload could not be completed. Please try again.');
    if (result.status < 200 || result.status >= 300) throw new Error(responseMessage(result.status, result.body));
    return (JSON.parse(result.body) as { evidence: TransactionEvidence }).evidence;
  });
  return { task, promise };
}

export async function removeTransactionEvidence(intakeId: string, evidenceId: string, idempotencyKey: string) {
  return apiRequest<{ intake: TransactionIntake; removedEvidenceId: string }>(
    `/api/document-intakes/${encodeURIComponent(intakeId)}/evidence/${encodeURIComponent(evidenceId)}`,
    { method: 'DELETE', headers: { 'Idempotency-Key': idempotencyKey } },
  );
}

export async function cancelTransactionIntake(intakeId: string, idempotencyKey: string) {
  return apiRequest<{ intake: TransactionIntake }>(`/api/document-intakes/${encodeURIComponent(intakeId)}`, {
    method: 'DELETE', headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export async function transactionEvidencePreviewUrl(intakeId: string, evidenceId: string) {
  const result = await apiRequest<{ url: string }>(
    `/api/document-intakes/${encodeURIComponent(intakeId)}/evidence/${encodeURIComponent(evidenceId)}/preview`,
  );
  return result.url;
}
