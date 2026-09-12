import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/client";
import { DOCUMENT_EVIDENCE_BUCKET, DOCUMENT_IMAGE_LIMITS, MAX_DOCUMENT_EVIDENCE_BYTES } from "@/lib/document-intake/validation";
import { extractionConfig } from "./config";
import { extractDocument, ExtractionPipelineError } from "./pipeline";
import { createOcrProviderFromEnvironment, OcrConfigurationError } from "./provider";
import type { OcrProvider } from "./types";

export type ClaimedExtractionJob = {
  extraction_id: string;
  intake_id: string;
  evidence_id: string;
  business_id: string;
  storage_bucket: string;
  object_path: string;
  magic_mime_type: string;
  file_name: string;
  file_size_bytes: number;
  page_count: number | null;
  document_version: number;
  attempt_count: number;
};

export type ExtractionRunResult = {
  claimed: number;
  completed: number;
  needsReview: number;
  retryScheduled: number;
  failed: number;
};

function validObjectScope(job: ClaimedExtractionJob) {
  return job.storage_bucket === DOCUMENT_EVIDENCE_BUCKET &&
    job.object_path.startsWith(`${job.business_id}/${job.intake_id}/${job.evidence_id}/`);
}

function safeFailure(error: unknown): { code: string; retryable: boolean } {
  if (error instanceof ExtractionPipelineError) return { code: error.code, retryable: error.retryable };
  if (error instanceof OcrConfigurationError) return { code: error.code, retryable: false };
  return { code: "EXTRACTION_PROCESSING_FAILED", retryable: false };
}

function boundedRawResult(value: Record<string, unknown>) {
  const serialized = JSON.stringify(value);
  if (serialized.length <= extractionConfig.maximumRawResultCharacters) return value;
  return {
    truncated: true,
    originalCharacters: serialized.length,
    preview: serialized.slice(0, extractionConfig.maximumRawResultCharacters),
  };
}

async function claimJob(service: AppSupabaseClient, workerId: string): Promise<ClaimedExtractionJob | null> {
  const { data, error } = await service.rpc("document_intake_claim_extraction", {
    p_worker_id: workerId,
    p_now: new Date().toISOString(),
  });
  if (error) throw new Error("EXTRACTION_CLAIM_FAILED");
  return data ? data as ClaimedExtractionJob : null;
}

async function completeJob(service: AppSupabaseClient, workerId: string, job: ClaimedExtractionJob, output: Awaited<ReturnType<typeof extractDocument>>) {
  const { error } = await service.rpc("document_intake_complete_extraction", {
    p_business_id: job.business_id,
    p_extraction_id: job.extraction_id,
    p_worker_id: workerId,
    p_provider: output.provider,
    p_provider_model: output.providerModel,
    p_provider_version: output.providerVersion,
    p_parser_version: output.parserVersion,
    p_extraction_method: output.extractionMethod,
    p_document_classification: output.result.document_kind.value,
    p_structured_result: output.result,
    p_candidates: output.result.field_candidates,
    p_protected_raw_result: boundedRawResult(output.protectedRawResult),
    p_confidence: output.confidence,
    p_warnings: output.result.warnings,
    p_needs_review: output.needsReview,
  });
  if (error) throw new Error("EXTRACTION_COMPLETION_FAILED");
}

async function failJob(service: AppSupabaseClient, workerId: string, job: ClaimedExtractionJob, failure: { code: string; retryable: boolean }) {
  const { data, error } = await service.rpc("document_intake_fail_extraction", {
    p_business_id: job.business_id,
    p_extraction_id: job.extraction_id,
    p_worker_id: workerId,
    p_error_code: failure.code,
    p_retryable: failure.retryable,
    p_max_attempts: extractionConfig.jobMaxAttempts,
  });
  if (error) throw new Error("EXTRACTION_FAILURE_WRITE_FAILED");
  return Boolean((data as { retry_scheduled?: boolean } | null)?.retry_scheduled);
}

export async function processNextExtraction(service: AppSupabaseClient, input: {
  workerId: string;
  ocrProvider?: OcrProvider | null;
}): Promise<"empty" | "completed" | "needs_review" | "retry_scheduled" | "failed"> {
  const job = await claimJob(service, input.workerId);
  if (!job) return "empty";
  try {
    if (!validObjectScope(job)) throw new ExtractionPipelineError("INVALID_STORAGE_SCOPE", false);
    if (!Number.isSafeInteger(job.file_size_bytes) || job.file_size_bytes <= 0 || job.file_size_bytes > Math.max(MAX_DOCUMENT_EVIDENCE_BYTES, DOCUMENT_IMAGE_LIMITS.maxBytes)) {
      throw new ExtractionPipelineError("FILE_SIZE_LIMIT_EXCEEDED", false);
    }
    const { data, error } = await service.storage.from(DOCUMENT_EVIDENCE_BUCKET).download(job.object_path);
    if (error || !data) throw new ExtractionPipelineError("EVIDENCE_DOWNLOAD_FAILED", true);
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (bytes.length !== job.file_size_bytes) throw new ExtractionPipelineError("EVIDENCE_SIZE_MISMATCH", false);
    const provider = input.ocrProvider === undefined ? createOcrProviderFromEnvironment() : input.ocrProvider;
    const output = await extractDocument({
      bytes,
      mimeType: job.magic_mime_type,
      evidenceId: job.evidence_id,
      declaredPageCount: job.page_count,
      ocrProvider: provider,
    });
    await completeJob(service, input.workerId, job, output);
    return output.needsReview ? "needs_review" : "completed";
  } catch (error) {
    const retryScheduled = await failJob(service, input.workerId, job, safeFailure(error));
    return retryScheduled ? "retry_scheduled" : "failed";
  }
}

export async function processExtractionQueue(service: AppSupabaseClient, limit = extractionConfig.jobsPerRun): Promise<ExtractionRunResult> {
  const result: ExtractionRunResult = { claimed: 0, completed: 0, needsReview: 0, retryScheduled: 0, failed: 0 };
  const workerId = `cron:${crypto.randomUUID()}`;
  for (let index = 0; index < Math.min(limit, extractionConfig.jobsPerRun); index += 1) {
    const outcome = await processNextExtraction(service, { workerId });
    if (outcome === "empty") break;
    result.claimed += 1;
    if (outcome === "completed") result.completed += 1;
    else if (outcome === "needs_review") result.needsReview += 1;
    else if (outcome === "retry_scheduled") result.retryScheduled += 1;
    else result.failed += 1;
  }
  return result;
}
