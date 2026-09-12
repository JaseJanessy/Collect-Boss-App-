import { NextRequest } from "next/server";
import { apiError, apiJson, authApiError, databaseApiError } from "@/lib/document-intake/api";
import { requireDocumentPermission, safeIntake, scopedIntake } from "@/lib/document-intake/server";
import { correlationId, documentActionSchema, readIdempotencyKey, requestDigest } from "@/lib/document-intake/validation";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ intakeId: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const access = await requireDocumentPermission(_request, "document_intake.read");
  if ("error" in access) return authApiError(access);
  const { intakeId } = await context.params;
  const intake = await scopedIntake(access, intakeId);
  if (!intake) return apiError("INTAKE_NOT_FOUND", "Document draft not found.", 404);
  const { data: confirmation } = await access.service.from("document_intake_confirmations")
    .select("confirmation_version,intake_version,confirmed_document_kind,chosen_amount_minor,currency,document_datetime,reference,bank,sender,recipient,transaction_nature,notes,confirmed_at")
    .eq("business_id", access.businessId).eq("intake_id", intakeId)
    .order("confirmation_version", { ascending: false }).limit(1).maybeSingle();
  return apiJson({ intake: safeIntake(intake), latestConfirmation: confirmation ?? null });
}

export async function PATCH(request: NextRequest, context: Context) {
  const parsed = documentActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_DOCUMENT_ACTION", "Invalid document draft action.", 400);
  const access = await requireDocumentPermission(request, "document_intake.submit");
  if ("error" in access) return authApiError(access);
  const idempotency = readIdempotencyKey(request.headers);
  if ("error" in idempotency) return apiError(idempotency.code, idempotency.error, 400);
  const { intakeId } = await context.params;
  const intake = await scopedIntake(access, intakeId);
  if (!intake) return apiError("INTAKE_NOT_FOUND", "Document draft not found.", 404);
  const requestHash = requestDigest({ intakeId, ...parsed.data });
  const correlation = correlationId(request.headers);

  const { data, error } = await access.service.rpc("document_intake_finalise", {
    p_business_id: access.businessId,
    p_intake_id: intakeId,
    p_actor_id: access.user.id,
    p_idempotency_key: idempotency.key,
    p_request_hash: requestHash,
    p_correlation_id: correlation,
  });
  if (error || !data) return databaseApiError(error?.message, "Unable to submit the document draft.");
  return apiJson({ intake: safeIntake(data), submitted: true });
}

export async function DELETE(request: NextRequest, context: Context) {
  const access = await requireDocumentPermission(request, "document_intake.create");
  if ("error" in access) return authApiError(access);
  const idempotency = readIdempotencyKey(request.headers);
  if ("error" in idempotency) return apiError(idempotency.code, idempotency.error, 400);
  const { intakeId } = await context.params;
  const requestHash = requestDigest({ intakeId, action: "cancel" });
  const { data, error } = await access.service.rpc("document_intake_cancel", {
    p_business_id: access.businessId,
    p_intake_id: intakeId,
    p_actor_id: access.user.id,
    p_idempotency_key: idempotency.key,
    p_request_hash: requestHash,
    p_correlation_id: correlationId(request.headers),
  });
  if (error || !data) return databaseApiError(error?.message, "Unable to cancel the document draft.");
  return apiJson({ intake: safeIntake(data), retained: true });
}
