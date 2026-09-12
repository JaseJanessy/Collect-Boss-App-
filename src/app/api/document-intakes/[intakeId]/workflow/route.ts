import { NextRequest } from "next/server";
import { apiError, apiJson, authApiError, databaseApiError } from "@/lib/document-intake/api";
import { requireDocumentPermission, scopedIntake } from "@/lib/document-intake/server";
import { loadWorkflow } from "@/lib/document-intake/workflow-server";
import { transactionWorkflowDraftSchema, workflowSubmissionError } from "@/lib/document-intake/workflow";
import { correlationId, readIdempotencyKey, requestDigest } from "@/lib/document-intake/validation";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ intakeId: string }> };

async function recordSubmitFailure(
  access: Awaited<ReturnType<typeof requireDocumentPermission>> & { businessId: string; user: { id: string }; role: string },
  intakeId: string,
  correlation: string,
  errorCode: string,
) {
  await access.service.from("audit_logs").insert({
    business_id: access.businessId,
    action: "document_intake.workflow_submit_failed",
    actor_type: "user",
    actor_id: access.user.id,
    actor_role: access.role,
    entity_type: "document_intake",
    entity_id: intakeId,
    correlation_id: correlation,
    metadata: { error_code: errorCode },
  });
}

export async function GET(request: NextRequest, context: Context) {
  const access = await requireDocumentPermission(request, "document_intake.read");
  if ("error" in access) return authApiError(access);
  const { intakeId } = await context.params;
  if (!await scopedIntake(access, intakeId, true)) return apiError("INTAKE_NOT_FOUND", "Document draft not found.", 404);
  try { return apiJson(await loadWorkflow(access, intakeId)); }
  catch { return apiError("WORKFLOW_LOAD_FAILED", "Unable to load the transaction workflow.", 500); }
}

export async function PUT(request: NextRequest, context: Context) {
  const access = await requireDocumentPermission(request, "document_intake.create");
  if ("error" in access) return authApiError(access);
  const idempotency = readIdempotencyKey(request.headers);
  if ("error" in idempotency) return apiError(idempotency.code, idempotency.error, 400);
  const parsed = transactionWorkflowDraftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_WORKFLOW_DRAFT", "Invalid transaction workflow draft.", 400);
  const { intakeId } = await context.params;
  if (!await scopedIntake(access, intakeId)) return apiError("INTAKE_NOT_FOUND", "Document draft not found.", 404);
  const requestHash = requestDigest({ intakeId, ...parsed.data });
  const { data, error } = await access.service.rpc("document_intake_save_workflow", {
    p_business_id: access.businessId, p_intake_id: intakeId, p_actor_id: access.user.id,
    p_expected_version: parsed.data.expectedVersion, p_step: parsed.data.step, p_draft_data: parsed.data,
    p_idempotency_key: idempotency.key, p_request_hash: requestHash, p_correlation_id: correlationId(request.headers),
  });
  if (error || !data) return databaseApiError(error?.message, "Unable to save the transaction workflow.");
  const row = data as unknown as { version: number; step: string; draft_data: unknown; updated_at: string };
  return apiJson({ workflow: { version: row.version, step: row.step, data: row.draft_data, updatedAt: row.updated_at } });
}

export async function POST(request: NextRequest, context: Context) {
  const access = await requireDocumentPermission(request, "document_intake.submit");
  if ("error" in access) return authApiError(access);
  const idempotency = readIdempotencyKey(request.headers);
  if ("error" in idempotency) return apiError(idempotency.code, idempotency.error, 400);
  const { intakeId } = await context.params;
  const correlation = correlationId(request.headers);
  if (!await scopedIntake(access, intakeId)) return apiError("INTAKE_NOT_FOUND", "Document draft not found.", 404);
  let loaded;
  try { loaded = await loadWorkflow(access, intakeId); }
  catch {
    await recordSubmitFailure(access, intakeId, correlation, "WORKFLOW_LOAD_FAILED");
    return apiError("WORKFLOW_LOAD_FAILED", "Unable to validate the transaction workflow.", 500);
  }
  if (!loaded.workflow) {
    await recordSubmitFailure(access, intakeId, correlation, "WORKFLOW_NOT_READY");
    return apiError("WORKFLOW_NOT_READY", "Complete the transaction workflow before submitting.", 409);
  }
  const parsed = transactionWorkflowDraftSchema.safeParse(loaded.workflow.data);
  if (!parsed.success) {
    await recordSubmitFailure(access, intakeId, correlation, "INVALID_WORKFLOW_DRAFT");
    return apiError("INVALID_WORKFLOW_DRAFT", "Complete the required transaction details.", 400);
  }
  if (loaded.duplicateMatches.some((match) => match.confidence === "exact")) {
    await recordSubmitFailure(access, intakeId, correlation, "EXACT_DUPLICATE_BLOCKED");
    return apiError("EXACT_DUPLICATE_BLOCKED", "This evidence exactly matches an existing transaction and cannot be posted again.", 409);
  }
  const invalid = workflowSubmissionError(parsed.data, loaded.duplicateMatches.length);
  if (invalid) {
    await recordSubmitFailure(access, intakeId, correlation, "WORKFLOW_NOT_READY");
    return apiError("WORKFLOW_NOT_READY", invalid, 409);
  }
  const requestHash = requestDigest({ intakeId, workflowVersion: loaded.workflow.version, action: "submit_workflow" });
  const { data, error } = await access.service.rpc("document_intake_submit_workflow", {
    p_business_id: access.businessId, p_intake_id: intakeId, p_actor_id: access.user.id,
    p_idempotency_key: idempotency.key, p_request_hash: requestHash, p_correlation_id: correlation,
  });
  if (error || !data) {
    await recordSubmitFailure(access, intakeId, correlation, "DATABASE_REJECTED");
    return databaseApiError(error?.message, "Unable to create the confirmed transaction records.");
  }
  return apiJson(data as Record<string, unknown>, 201);
}
