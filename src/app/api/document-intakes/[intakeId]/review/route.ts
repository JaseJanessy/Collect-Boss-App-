import type { NextRequest } from "next/server";
import { apiError, apiJson, authApiError, databaseApiError } from "@/lib/document-intake/api";
import { buildReviewWorkspace, prepareDocumentReview, type ReviewExtraction } from "@/lib/document-intake/review";
import { requireDocumentPermission, safeEvidence, scopedIntake, type IntakeEvidenceRecord } from "@/lib/document-intake/server";
import { correlationId, documentReviewActionSchema, readIdempotencyKey, requestDigest } from "@/lib/document-intake/validation";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ intakeId: string }> };
type Row = Record<string, unknown>;

function safeReviewStructuredResult(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  return {
    document_kind: result.document_kind,
    amount_candidates: result.amount_candidates,
    transaction_date_candidates: result.transaction_date_candidates,
    reference_candidates: result.reference_candidates,
    bank_candidates: result.bank_candidates,
    sender_candidates: result.sender_candidates,
    recipient_candidates: result.recipient_candidates,
    status_candidates: result.status_candidates,
    warnings: result.warnings,
    parser_version: result.parser_version,
  };
}

function safeExtraction(row: Row): ReviewExtraction {
  return {
    id: String(row.id),
    evidenceId: String(row.evidence_id),
    extractionVersion: typeof row.extraction_version === "number" ? row.extraction_version : row.extraction_version === null ? null : Number(row.extraction_version),
    documentVersion: typeof row.document_version === "number" ? row.document_version : row.document_version === null ? null : Number(row.document_version),
    status: String(row.status),
    documentKind: typeof row.document_classification === "string" ? row.document_classification : null,
    classificationConfidence: typeof row.confidence === "number" ? row.confidence : row.confidence === null ? null : Number(row.confidence),
    structuredResult: safeReviewStructuredResult(row.structured_result),
    parserVersion: String(row.parser_version),
    provider: String(row.provider),
    providerModel: typeof row.provider_model === "string" ? row.provider_model : null,
    providerVersion: typeof row.provider_version === "string" ? row.provider_version : null,
    extractionMethod: typeof row.extraction_method === "string" ? row.extraction_method : null,
    completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
  };
}

function safeConfirmation(row: Row | null) {
  if (!row) return null;
  return {
    id: row.id,
    version: row.confirmation_version,
    intakeVersion: row.intake_version,
    reviewStatus: row.review_status,
    extractionId: row.extraction_id,
    documentKind: row.confirmed_document_kind,
    representsFinancialMovement: row.represents_financial_movement,
    amountMinor: row.chosen_amount_minor,
    currency: row.currency,
    transactionDatetime: row.document_datetime,
    timezone: row.confirmed_timezone,
    reference: row.reference,
    bank: row.bank,
    sender: row.sender,
    recipient: row.recipient,
    transactionStatus: row.transaction_status,
    transactionNature: row.transaction_nature,
    transactionNatureNote: row.transaction_nature_note,
    chosenAmountCandidateId: row.chosen_amount_candidate_id,
    chosenAmountOriginal: row.chosen_amount_original,
    manualAmountReason: row.manual_amount_reason,
    referenceOriginal: row.reference_original,
    currencyConfirmed: row.currency_confirmed,
    dateInterpretationConfirmed: row.date_interpretation_confirmed,
    fieldDecisions: row.field_decisions,
    evidenceCitations: row.evidence_citations,
    validationIssues: row.validation_issues,
    notes: row.notes,
    reviewedBy: row.confirmed_by,
    reviewedAt: row.confirmed_at,
  };
}

async function loadReviewData(access: Awaited<ReturnType<typeof requireDocumentPermission>>, intakeId: string) {
  if ("error" in access) return null;
  const [evidenceResult, extractionResult, confirmationResult, businessResult] = await Promise.all([
    access.service.from("evidence_files")
      .select("id,intake_id,file_name,file_size_bytes,evidence_type,evidence_version,is_current,scan_status,processing_status,duplicate_match_status,page_count,image_width,image_height,evidence_source,quality_warnings,magic_mime_type,uploaded_at")
      .eq("business_id", access.businessId).eq("intake_id", intakeId).eq("kind", "original")
      .order("evidence_version", { ascending: false }),
    access.service.from("document_intake_extractions")
      .select("id,evidence_id,extraction_version,document_version,status,document_classification,structured_result,confidence,provider,provider_model,provider_version,parser_version,extraction_method,completed_at,created_at")
      .eq("business_id", access.businessId).eq("intake_id", intakeId).order("created_at", { ascending: false }),
    access.service.from("document_intake_confirmations")
      .select("id,confirmation_version,intake_version,review_status,extraction_id,confirmed_document_kind,represents_financial_movement,chosen_amount_minor,currency,document_datetime,confirmed_timezone,reference,bank,sender,recipient,transaction_status,transaction_nature,transaction_nature_note,chosen_amount_candidate_id,chosen_amount_original,manual_amount_reason,reference_original,currency_confirmed,date_interpretation_confirmed,field_decisions,evidence_citations,validation_issues,notes,confirmed_by,confirmed_at")
      .eq("business_id", access.businessId).eq("intake_id", intakeId).order("confirmation_version", { ascending: false }).limit(20),
    access.service.from("businesses").select("default_currency,timezone").eq("id", access.businessId).single(),
  ]);
  if (evidenceResult.error || extractionResult.error || confirmationResult.error || businessResult.error || !businessResult.data) return null;
  const evidence = (evidenceResult.data ?? []) as unknown as IntakeEvidenceRecord[];
  const extractions = ((extractionResult.data ?? []) as unknown as Row[]).map(safeExtraction);
  const currentEvidence = evidence.find((item) => item.is_current) ?? null;
  const latestExtraction = extractions.find((item) => item.evidenceId === currentEvidence?.id) ?? null;
  return {
    evidence,
    currentEvidence,
    extractions,
    latestExtraction,
    confirmations: ((confirmationResult.data ?? []) as unknown as Row[]).map((row) => safeConfirmation(row)),
    business: businessResult.data as { default_currency: string; timezone: string },
  };
}

export async function GET(request: NextRequest, context: Context) {
  const access = await requireDocumentPermission(request, "document_intake.read");
  if ("error" in access) return authApiError(access);
  const { intakeId } = await context.params;
  if (!await scopedIntake(access, intakeId)) return apiError("INTAKE_NOT_FOUND", "Document draft not found.", 404);
  const data = await loadReviewData(access, intakeId);
  if (!data) return apiError("REVIEW_WORKSPACE_FAILED", "Unable to load the document review workspace.", 500);
  return apiJson({
    workspace: buildReviewWorkspace(data.latestExtraction),
    currentEvidence: data.currentEvidence ? safeEvidence(data.currentEvidence) : null,
    evidenceVersions: data.evidence.map(safeEvidence),
    extractionVersions: data.extractions,
    latestReview: data.confirmations[0] ?? null,
    reviewVersions: data.confirmations,
    business: { defaultCurrency: data.business.default_currency, timezone: data.business.timezone },
  });
}

export async function PATCH(request: NextRequest, context: Context) {
  const parsed = documentReviewActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_REVIEW", "The document review payload is invalid.", 400);
  const access = await requireDocumentPermission(request, "document_intake.create");
  if ("error" in access) return authApiError(access);
  const idempotency = readIdempotencyKey(request.headers);
  if ("error" in idempotency) return apiError(idempotency.code, idempotency.error, 400);
  const { intakeId } = await context.params;
  const intake = await scopedIntake(access, intakeId);
  if (!intake) return apiError("INTAKE_NOT_FOUND", "Document draft not found.", 404);
  const data = await loadReviewData(access, intakeId);
  if (!data || !data.currentEvidence) return apiError("EVIDENCE_REQUIRED", "Upload evidence before reviewing this draft.", 409);
  if (!data.latestExtraction || ["queued", "processing"].includes(data.latestExtraction.status)) {
    return apiError("EXTRACTION_PENDING", "Wait for extraction to finish, or retry it if processing failed.", 409);
  }
  const confirming = parsed.data.action === "confirm";
  const workspace = buildReviewWorkspace(data.latestExtraction);
  const prepared = prepareDocumentReview(parsed.data.review, workspace, {
    confirm: confirming,
    supportedCurrencies: [data.business.default_currency.toUpperCase()],
  });
  if (confirming && prepared.validation_issues.length) {
    return apiJson({ error: { code: "REVIEW_INCOMPLETE", message: "Complete the required human review fields.", issues: prepared.validation_issues } }, 422);
  }
  const requestHash = requestDigest({ intakeId, action: parsed.data.action, review: prepared });
  const { data: confirmation, error } = await access.service.rpc("document_intake_save_review", {
    p_business_id: access.businessId,
    p_intake_id: intakeId,
    p_actor_id: access.user.id,
    p_action: parsed.data.action,
    p_review: prepared,
    p_idempotency_key: idempotency.key,
    p_request_hash: requestHash,
    p_correlation_id: correlationId(request.headers),
  });
  if (error || !confirmation) return databaseApiError(error?.message, "Unable to save the document review.");
  return apiJson({ review: safeConfirmation(confirmation as unknown as Row), readyToSubmit: prepared.review_status === "confirmed" });
}
