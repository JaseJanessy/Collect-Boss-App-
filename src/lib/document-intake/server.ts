import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/client";
import type { DocumentIntakeRow } from "@/lib/supabase/types";
import type { NextRequest } from "next/server";
import type { TenantPermission } from "@/lib/auth/permissions";
import { requireMobilePermission } from "@/lib/auth/mobile-access";
import { requireTenantPermission } from "@/lib/auth/tenant-access";
import { apiError, databaseApiError } from "./api";
import {
  DOCUMENT_EVIDENCE_BUCKET,
  documentEvidenceObjectPath,
  documentPreviewObjectPath,
  requestDigest,
  validateDocumentUpload,
} from "./validation";
import { createSafeImagePreview } from "./image-processing";
import { deploymentScannerConfigurationError } from "./scanning/provider";
import { kickDocumentQueues } from "./queue-kick";

export interface DocumentAccess {
  businessId: string;
  user: { id: string };
  role: string;
  service: AppSupabaseClient;
}

export type DocumentIntakeRecord = DocumentIntakeRow;

export interface IntakeEvidenceRecord {
  id: string;
  intake_id: string;
  file_name: string;
  file_size_bytes: number;
  evidence_type: string;
  evidence_version: number;
  is_current: boolean;
  scan_status: string;
  processing_status: string;
  duplicate_match_status: string;
  page_count: number | null;
  image_width: number | null;
  image_height: number | null;
  evidence_source: string | null;
  quality_warnings: string[] | null;
  magic_mime_type: string | null;
  uploaded_at: string;
}

export async function requireDocumentPermission(request: NextRequest, permission: TenantPermission) {
  if ((request.headers.get("authorization") ?? "").startsWith("Bearer ")) {
    return requireMobilePermission(request, permission);
  }
  return requireTenantPermission(permission);
}

export function safeIntake(intake: DocumentIntakeRecord) {
  return {
    id: intake.id,
    status: intake.status,
    source: intake.source,
    intendedWorkflow: intake.intended_workflow,
    currencyHint: intake.currency_hint,
    assignedTo: intake.assigned_to,
    version: intake.version,
    submittedAt: intake.submitted_at,
    cancelledAt: intake.cancelled_at,
    retentionUntil: intake.retention_until,
    createdAt: intake.created_at,
    updatedAt: intake.updated_at,
  };
}

export function safeEvidence(file: IntakeEvidenceRecord) {
  return {
    id: file.id,
    originalFilename: file.file_name,
    bytes: file.file_size_bytes,
    documentKind: file.evidence_type,
    version: file.evidence_version,
    isCurrent: file.is_current,
    scanStatus: file.scan_status,
    processingStatus: file.processing_status,
    duplicateWarning: file.duplicate_match_status === "exact_hash_warning",
    pageCount: file.page_count,
    imageWidth: file.image_width,
    imageHeight: file.image_height,
    evidenceSource: file.evidence_source,
    qualityWarnings: file.quality_warnings ?? [],
    hasSafePreview: file.magic_mime_type?.startsWith("image/") ?? false,
    uploadedAt: file.uploaded_at,
  };
}

export async function scopedIntake(access: DocumentAccess, intakeId: string, includeDeleted = false) {
  let query = access.service.from("document_intakes").select("*")
    .eq("id", intakeId).eq("business_id", access.businessId);
  if (!includeDeleted) query = query.is("deleted_at", null);
  const { data, error } = await query.maybeSingle();
  return error || !data ? null : data as DocumentIntakeRecord;
}

async function recordUploadFailure(access: DocumentAccess, intakeId: string, correlation: string, errorCode: string) {
  await access.service.rpc("document_intake_transition", {
    p_business_id: access.businessId,
    p_intake_id: intakeId,
    p_actor_id: access.user.id,
    p_to_status: "failed",
    p_action: "document_evidence.upload_failed",
    p_error_code: errorCode,
    p_correlation_id: correlation,
  });
}

export async function storeOriginalEvidence(input: {
  access: DocumentAccess;
  intake: DocumentIntakeRecord;
  file: File;
  documentKind: string;
  evidenceSource: "pdf" | "screenshot" | "bank_in_receipt" | "other_image";
  rotationDegrees: number;
  cropInsetPercent: number;
  uploadSource: string;
  idempotencyKey: string;
  correlation: string;
  actionScope: "upload" | "replace";
  supersedesEvidenceId?: string;
}): Promise<{ record: IntakeEvidenceRecord; idempotent: boolean } | { response: ReturnType<typeof apiError> }> {
  const scannerConfigurationError = deploymentScannerConfigurationError();
  if (scannerConfigurationError) {
    return { response: apiError(scannerConfigurationError, "Document malware scanning is not configured.", 503) };
  }
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const validated = validateDocumentUpload(input.file, bytes);
  if ("error" in validated) return { response: apiError(validated.code, validated.error, 422) };
  if ((validated.category === "pdf") !== (input.evidenceSource === "pdf")) {
    return { response: apiError("EVIDENCE_SOURCE_MISMATCH", "The selected evidence type does not match the uploaded file.", 422) };
  }
  const imagePreview = validated.category === "image" ? await createSafeImagePreview(bytes, {
    rotationDegrees: input.rotationDegrees, cropInsetPercent: input.cropInsetPercent,
  }) : null;
  if (imagePreview && "error" in imagePreview && typeof imagePreview.error === "string") {
    return { response: apiError(imagePreview.code, imagePreview.error, 422) };
  }
  const requestHash = requestDigest({
    intakeId: input.intake.id,
    sha256: validated.sha256,
    documentKind: input.documentKind,
    uploadSource: input.uploadSource,
    evidenceSource: input.evidenceSource,
    rotationDegrees: input.rotationDegrees,
    cropInsetPercent: input.cropInsetPercent,
    supersedesEvidenceId: input.supersedesEvidenceId ?? null,
  });

  const { data: repeated } = await input.access.service.from("evidence_files").select("*")
    .eq("business_id", input.access.businessId)
    .eq("idempotency_scope", input.actionScope)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (repeated) {
    if (repeated.request_hash !== requestHash) {
      return { response: apiError("IDEMPOTENCY_CONFLICT", "This idempotency key was already used for a different request.", 409) };
    }
    return { record: repeated as IntakeEvidenceRecord, idempotent: true };
  }

  const { error: transitionError } = await input.access.service.rpc("document_intake_transition", {
    p_business_id: input.access.businessId,
    p_intake_id: input.intake.id,
    p_actor_id: input.access.user.id,
    p_to_status: "awaiting_upload",
    p_action: input.actionScope === "replace" ? "document_evidence.replacement_started" : "document_evidence.upload_started",
    p_error_code: null,
    p_correlation_id: input.correlation,
  });
  if (transitionError) return { response: databaseApiError(transitionError.message, "Unable to prepare the document upload.") };

  const evidenceId = crypto.randomUUID();
  const storage = documentEvidenceObjectPath({
    businessId: input.access.businessId,
    intakeId: input.intake.id,
    evidenceId,
    extension: validated.extension,
  });
  const previewStorage = validated.category === "image" ? documentPreviewObjectPath({
    businessId: input.access.businessId, intakeId: input.intake.id, evidenceId,
  }) : null;
  const { error: storageError } = await input.access.service.storage.from(DOCUMENT_EVIDENCE_BUCKET).upload(storage.objectPath, bytes, {
    upsert: false,
    contentType: validated.magicMimeType,
    cacheControl: "private, no-store",
  });
  if (storageError) {
    await recordUploadFailure(input.access, input.intake.id, input.correlation, "STORAGE_UPLOAD_FAILED");
    return { response: apiError("STORAGE_UPLOAD_FAILED", "Unable to store the document securely.", 502) };
  }
  if (previewStorage && imagePreview && !("error" in imagePreview)) {
    const { error: previewError } = await input.access.service.storage.from(DOCUMENT_EVIDENCE_BUCKET).upload(
      previewStorage.objectPath, imagePreview.previewBytes,
      { upsert: false, contentType: "image/jpeg", cacheControl: "private, no-store" },
    );
    if (previewError) {
      await input.access.service.storage.from(DOCUMENT_EVIDENCE_BUCKET).remove([storage.objectPath, previewStorage.objectPath]);
      await recordUploadFailure(input.access, input.intake.id, input.correlation, "PREVIEW_UPLOAD_FAILED");
      return { response: apiError("PREVIEW_UPLOAD_FAILED", "Unable to create a safe image preview.", 502) };
    }
  }

  const { data, error } = await input.access.service.rpc("document_intake_attach_evidence", {
    p_business_id: input.access.businessId,
    p_intake_id: input.intake.id,
    p_actor_id: input.access.user.id,
    p_evidence_id: evidenceId,
    p_original_filename: validated.originalFilename,
    p_generated_storage_name: storage.generatedStorageName,
    p_storage_bucket: DOCUMENT_EVIDENCE_BUCKET,
    p_object_path: storage.objectPath,
    p_declared_mime_type: input.file.type,
    p_magic_mime_type: validated.magicMimeType,
    p_file_size_bytes: input.file.size,
    p_page_count: validated.pageCount,
    p_image_width: imagePreview && !("error" in imagePreview) ? imagePreview.originalWidth : null,
    p_image_height: imagePreview && !("error" in imagePreview) ? imagePreview.originalHeight : null,
    p_sha256: validated.sha256,
    p_document_kind: input.documentKind,
    p_evidence_source: input.evidenceSource,
    p_quality_warnings: imagePreview && !("error" in imagePreview) ? imagePreview.warnings : [],
    p_preview_object_path: previewStorage?.objectPath ?? null,
    p_preview_generated_name: previewStorage?.generatedStorageName ?? null,
    p_preview_size_bytes: imagePreview && !("error" in imagePreview) ? imagePreview.previewBytes.length : null,
    p_preview_width: imagePreview && !("error" in imagePreview) ? imagePreview.previewWidth : null,
    p_preview_height: imagePreview && !("error" in imagePreview) ? imagePreview.previewHeight : null,
    p_preview_sha256: imagePreview && !("error" in imagePreview) ? imagePreview.previewSha256 : null,
    p_derivative_transform: { rotation_degrees: input.rotationDegrees, crop_inset_percent: input.cropInsetPercent,
      exif_orientation: imagePreview && !("error" in imagePreview) ? imagePreview.orientation : null },
    p_upload_source: input.uploadSource,
    p_action_scope: input.actionScope,
    p_idempotency_key: input.idempotencyKey,
    p_request_hash: requestHash,
    p_supersedes_evidence_id: input.supersedesEvidenceId ?? null,
    p_scan_provider: process.env.DOCUMENT_MALWARE_SCANNER_PROVIDER?.trim() || "unconfigured",
    p_correlation_id: input.correlation,
  });

  if (error || !data) {
    const idempotencyConflict = error?.message.includes("P8_IDEMPOTENCY_CONFLICT") ?? false;
    const cleanupPaths = [storage.objectPath, previewStorage?.objectPath].filter((path): path is string => Boolean(path));
    const cleanup = await input.access.service.storage.from(DOCUMENT_EVIDENCE_BUCKET).remove(cleanupPaths);
    if (cleanup.error) {
      await input.access.service.from("audit_logs").insert({
        business_id: input.access.businessId,
        action: "document_evidence.cleanup_failed",
        actor_type: "system",
        actor_id: input.access.user.id,
        actor_role: input.access.role,
        entity_type: "document_intake",
        entity_id: input.intake.id,
        correlation_id: input.correlation,
        idempotency_key: input.idempotencyKey,
        metadata: { error_code: "STORAGE_CLEANUP_FAILED", orphan_evidence_id: evidenceId },
      });
    }
    if (!idempotencyConflict) {
      await recordUploadFailure(input.access, input.intake.id, input.correlation, "METADATA_WRITE_FAILED");
    }
    return { response: databaseApiError(error?.message, "Document metadata could not be saved; storage cleanup was attempted.") };
  }

  const record = data as IntakeEvidenceRecord;
  if (record.id !== evidenceId) {
    // An idempotent concurrent request won the database race. Its object is the
    // authoritative original; remove this request's unreferenced object.
    await input.access.service.storage.from(DOCUMENT_EVIDENCE_BUCKET).remove(
      [storage.objectPath, previewStorage?.objectPath].filter((path): path is string => Boolean(path)),
    );
    return { record, idempotent: true };
  }
  kickDocumentQueues();
  return { record, idempotent: false };
}
