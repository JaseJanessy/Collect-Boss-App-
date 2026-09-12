import { NextRequest } from "next/server";
import { apiError, apiJson, authApiError, databaseApiError } from "@/lib/document-intake/api";
import { requireDocumentPermission, scopedIntake } from "@/lib/document-intake/server";
import { correlationId, readIdempotencyKey, requestDigest } from "@/lib/document-intake/validation";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ intakeId: string }> };

function safeStructuredResult(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = value as Record<string, unknown>;
  return {
    documentKind: result.document_kind,
    reconciliation: result.reconciliation,
    warnings: result.warnings,
    parserVersion: result.parser_version,
  };
}

function maskIdentifier(value: string) {
  const compact = value.replace(/\s+/gu, "");
  return compact.length <= 4 ? "••••" : `${"•".repeat(Math.min(8, compact.length - 4))}${compact.slice(-4)}`;
}

function safeCandidate(value: Record<string, unknown>, canViewSensitive: boolean) {
  const sensitive = value.sensitivity === "sensitive_identifier";
  const original = String(value.original_text ?? "");
  const normalized = value.normalized_value;
  return {
    id: value.id,
    fieldType: value.field_type,
    originalText: sensitive && !canViewSensitive ? maskIdentifier(original) : original,
    normalizedValue: sensitive && !canViewSensitive ? maskIdentifier(String(normalized ?? "")) : normalized,
    confidence: value.confidence,
    source: {
      documentVersion: value.document_version,
      page: value.source_page,
      imageId: value.source_image_id,
      boundingBox: value.source_bounding_box,
      textSpan: value.source_text_span,
      snippet: sensitive && !canViewSensitive ? "Sensitive identifier masked" : value.source_snippet,
      extractionMethod: value.extraction_method,
      provider: value.provider,
      providerVersion: value.provider_version,
      parserVersion: value.parser_version,
    },
    validationFlags: value.validation_flags,
    duplicateGroup: value.duplicate_group,
  };
}

function safeExtraction(value: Record<string, unknown>) {
  return {
    id: value.id,
    evidenceId: value.evidence_id,
    status: value.status,
    processingStatus: value.status,
    documentKind: value.document_classification,
    classificationConfidence: value.confidence,
    extractionVersion: value.extraction_version,
    documentVersion: value.document_version,
    structuredResult: safeStructuredResult(value.structured_result),
    warnings: value.warnings,
    provider: value.provider,
    providerModel: value.provider_model,
    providerVersion: value.provider_version,
    parserVersion: value.parser_version,
    extractionMethod: value.extraction_method,
    attemptCount: value.attempt_count,
    errorCode: value.error_code,
    startedAt: value.started_at,
    completedAt: value.completed_at,
    updatedAt: value.updated_at,
  };
}

export async function GET(request: NextRequest, context: Context) {
  const access = await requireDocumentPermission(request, "document_intake.read");
  if ("error" in access) return authApiError(access);
  const { intakeId } = await context.params;
  if (!await scopedIntake(access, intakeId)) return apiError("INTAKE_NOT_FOUND", "Document draft not found.", 404);
  const { data, error } = await access.service.from("document_intake_extractions")
    .select("id,evidence_id,extraction_version,document_version,status,document_classification,structured_result,confidence,warnings,provider,provider_model,provider_version,parser_version,extraction_method,attempt_count,error_code,started_at,completed_at,updated_at")
    .eq("business_id", access.businessId).eq("intake_id", intakeId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return apiError("EXTRACTION_STATUS_FAILED", "Unable to load extraction status.", 500);
  if (!data) return apiJson({ extraction: null, candidates: [] });
  const { data: candidates, error: candidateError } = await access.service.from("document_extraction_candidates")
    .select("id,field_type,original_text,normalized_value,confidence,document_version,source_page,source_image_id,source_bounding_box,source_text_span,source_snippet,extraction_method,provider,provider_version,parser_version,validation_flags,sensitivity,duplicate_group")
    .eq("business_id", access.businessId).eq("extraction_id", data.id).order("field_type").order("candidate_ordinal");
  if (candidateError) return apiError("EXTRACTION_CANDIDATES_FAILED", "Unable to load extracted candidates.", 500);
  const canViewSensitive = access.role === "owner" || access.role === "admin" || access.role === "manager";
  return apiJson({ extraction: safeExtraction(data as Record<string, unknown>), candidates: (candidates ?? []).map((item: Record<string, unknown>) => safeCandidate(item, canViewSensitive)) });
}

export async function POST(request: NextRequest, context: Context) {
  const access = await requireDocumentPermission(request, "document_intake.create");
  if ("error" in access) return authApiError(access);
  const idempotency = readIdempotencyKey(request.headers);
  if ("error" in idempotency) return apiError(idempotency.code, idempotency.error, 400);
  const { intakeId } = await context.params;
  if (!await scopedIntake(access, intakeId)) return apiError("INTAKE_NOT_FOUND", "Document draft not found.", 404);
  const requestHash = requestDigest({ intakeId, action: "requeue_extraction" });
  const { data, error } = await access.service.rpc("document_intake_requeue_extraction", {
    p_business_id: access.businessId,
    p_intake_id: intakeId,
    p_actor_id: access.user.id,
    p_idempotency_key: idempotency.key,
    p_request_hash: requestHash,
    p_correlation_id: correlationId(request.headers),
  });
  if (error || !data) return databaseApiError(error?.message, "Unable to queue document extraction.");
  return apiJson({ extraction: safeExtraction(data as Record<string, unknown>), idempotent: true }, 202);
}
