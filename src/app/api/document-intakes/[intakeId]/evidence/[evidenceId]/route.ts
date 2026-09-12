import { NextRequest } from "next/server";
import { apiError, apiJson, authApiError, databaseApiError } from "@/lib/document-intake/api";
import { requireDocumentPermission, safeIntake, scopedIntake } from "@/lib/document-intake/server";
import { correlationId, readIdempotencyKey, requestDigest } from "@/lib/document-intake/validation";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ intakeId: string; evidenceId: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  const access = await requireDocumentPermission(request, "document_intake.create");
  if ("error" in access) return authApiError(access);
  const idempotency = readIdempotencyKey(request.headers);
  if ("error" in idempotency) return apiError(idempotency.code, idempotency.error, 400);
  const { intakeId, evidenceId } = await context.params;
  if (!await scopedIntake(access, intakeId)) return apiError("INTAKE_NOT_FOUND", "Document draft not found.", 404);
  const requestHash = requestDigest({ intakeId, evidenceId, action: "remove" });
  const { data, error } = await access.service.rpc("document_intake_remove_evidence", {
    p_business_id: access.businessId,
    p_intake_id: intakeId,
    p_actor_id: access.user.id,
    p_evidence_id: evidenceId,
    p_idempotency_key: idempotency.key,
    p_request_hash: requestHash,
    p_correlation_id: correlationId(request.headers),
  });
  if (error || !data) return databaseApiError(error?.message, "Unable to remove the PDF from this draft.");
  return apiJson({ intake: safeIntake(data), removedEvidenceId: evidenceId, retained: true });
}
