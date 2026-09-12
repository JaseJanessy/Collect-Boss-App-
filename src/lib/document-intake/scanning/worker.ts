import "server-only";

import { createHash } from "node:crypto";
import type { AppSupabaseClient } from "@/lib/supabase/client";
import { DOCUMENT_EVIDENCE_BUCKET, DOCUMENT_IMAGE_LIMITS, MAX_DOCUMENT_EVIDENCE_BYTES } from "@/lib/document-intake/validation";
import { createMalwareScannerFromEnvironment, MalwareScannerConfigurationError, type MalwareScanner } from "./provider";

export type ClaimedScanJob = {
  evidence_id: string; intake_id: string; business_id: string; storage_bucket: string; object_path: string;
  file_size_bytes: number; magic_mime_type: string; content_sha256: string; attempt_count: number;
};

export type ScanQueueResult = { claimed: number; clean: number; quarantined: number; retryScheduled: number; failed: number };
const maxAttempts = 3;
const maxJobs = 3;
const timeoutMs = 30_000;

function safeFailure(error: unknown) {
  if (error instanceof MalwareScannerConfigurationError) return { code: error.code, retryable: false };
  if (error instanceof Error && (error.name === "AbortError" || error.message.includes("TIMEOUT"))) return { code: "MALWARE_SCANNER_TIMEOUT", retryable: true };
  if (error instanceof Error && error.message === "EVIDENCE_DOWNLOAD_FAILED") return { code: error.message, retryable: true };
  if (error instanceof Error && [
    "INVALID_STORAGE_SCOPE",
    "FILE_SIZE_LIMIT_EXCEEDED",
    "EVIDENCE_SIZE_MISMATCH",
    "EVIDENCE_HASH_MISMATCH",
    "SCANNER_RESPONSE_INVALID",
    "SCANNER_RESPONSE_TOO_LARGE",
  ].includes(error.message)) return { code: error.message, retryable: false };
  return { code: "MALWARE_SCANNER_UNAVAILABLE", retryable: true };
}

async function claim(service: AppSupabaseClient, workerId: string): Promise<ClaimedScanJob | null> {
  const { data, error } = await service.rpc("document_evidence_claim_scan", { p_worker_id: workerId, p_now: new Date().toISOString() });
  if (error) throw new Error("SCAN_CLAIM_FAILED");
  return data ? data as ClaimedScanJob : null;
}

async function fail(service: AppSupabaseClient, workerId: string, job: ClaimedScanJob, failure: { code: string; retryable: boolean }) {
  const { data, error } = await service.rpc("document_evidence_fail_scan", {
    p_business_id: job.business_id, p_evidence_id: job.evidence_id, p_worker_id: workerId,
    p_error_code: failure.code, p_retryable: failure.retryable, p_max_attempts: maxAttempts,
  });
  if (error) throw new Error("SCAN_FAILURE_WRITE_FAILED");
  return Boolean((data as { retry_scheduled?: boolean } | null)?.retry_scheduled);
}

export async function processNextEvidenceScan(service: AppSupabaseClient, input: { workerId: string; scanner?: MalwareScanner }) {
  const job = await claim(service, input.workerId);
  if (!job) return "empty" as const;
  try {
    if (job.storage_bucket !== DOCUMENT_EVIDENCE_BUCKET || !job.object_path.startsWith(`${job.business_id}/${job.intake_id}/${job.evidence_id}/`)) {
      throw new Error("INVALID_STORAGE_SCOPE");
    }
    if (!Number.isSafeInteger(job.file_size_bytes) || job.file_size_bytes <= 0 || job.file_size_bytes > Math.max(MAX_DOCUMENT_EVIDENCE_BYTES, DOCUMENT_IMAGE_LIMITS.maxBytes)) {
      throw new Error("FILE_SIZE_LIMIT_EXCEEDED");
    }
    const { data, error } = await service.storage.from(DOCUMENT_EVIDENCE_BUCKET).download(job.object_path);
    if (error || !data) throw new Error("EVIDENCE_DOWNLOAD_FAILED");
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (bytes.length !== job.file_size_bytes) throw new Error("EVIDENCE_SIZE_MISMATCH");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== job.content_sha256) throw new Error("EVIDENCE_HASH_MISMATCH");
    const scanner = input.scanner ?? createMalwareScannerFromEnvironment();
    if (!scanner) throw new MalwareScannerConfigurationError("Malware scanner is disabled.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("SCANNER_TIMEOUT")), timeoutMs);
    let verdict;
    try { verdict = await scanner.scan({ bytes, mimeType: job.magic_mime_type, sha256 }, controller.signal); }
    finally { clearTimeout(timer); }
    const { error: completionError } = await service.rpc("document_evidence_complete_scan", {
      p_business_id: job.business_id, p_evidence_id: job.evidence_id, p_worker_id: input.workerId,
      p_provider: scanner.name, p_provider_version: scanner.version, p_verdict: verdict, p_scanned_sha256: sha256,
    });
    if (completionError) throw new Error("SCAN_COMPLETION_FAILED");
    return verdict === "clean" ? "clean" as const : "quarantined" as const;
  } catch (error) {
    const retry = await fail(service, input.workerId, job, safeFailure(error));
    return retry ? "retry_scheduled" as const : "failed" as const;
  }
}

export async function processEvidenceScanQueue(service: AppSupabaseClient, limit = maxJobs): Promise<ScanQueueResult> {
  const result: ScanQueueResult = { claimed: 0, clean: 0, quarantined: 0, retryScheduled: 0, failed: 0 };
  const scanner = createMalwareScannerFromEnvironment();
  if (!scanner) throw new MalwareScannerConfigurationError("Malware scanner is disabled.");
  const workerId = `scan:${crypto.randomUUID()}`;
  for (let index = 0; index < Math.min(limit, maxJobs); index += 1) {
    const outcome = await processNextEvidenceScan(service, { workerId, scanner });
    if (outcome === "empty") break;
    result.claimed += 1;
    if (outcome === "clean") result.clean += 1;
    else if (outcome === "quarantined") result.quarantined += 1;
    else if (outcome === "retry_scheduled") result.retryScheduled += 1;
    else result.failed += 1;
  }
  return result;
}
