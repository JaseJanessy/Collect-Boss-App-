import { NextRequest } from "next/server";
import { apiError, apiJson, authApiError, databaseApiError } from "@/lib/document-intake/api";
import { requireDocumentPermission, safeIntake, type DocumentIntakeRecord } from "@/lib/document-intake/server";
import { correlationId, createDocumentIntakeSchema, readIdempotencyKey, requestDigest } from "@/lib/document-intake/validation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await requireDocumentPermission(request, "document_intake.read");
  if ("error" in access) return authApiError(access);
  const { data, error } = await access.service.from("document_intakes").select("*")
    .eq("business_id", access.businessId).is("deleted_at", null).order("updated_at", { ascending: false });
  if (error) return apiError("DOCUMENT_LIST_FAILED", "Unable to load document drafts.", 500);
  return apiJson({ intakes: ((data ?? []) as DocumentIntakeRecord[]).map(safeIntake) });
}

export async function POST(request: NextRequest) {
  const access = await requireDocumentPermission(request, "document_intake.create");
  if ("error" in access) return authApiError(access);
  const idempotency = readIdempotencyKey(request.headers);
  if ("error" in idempotency) return apiError(idempotency.code, idempotency.error, 400);
  const parsed = createDocumentIntakeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_DOCUMENT_DRAFT", "Invalid document draft request.", 400);
  const requestHash = requestDigest(parsed.data);
  const { data: business } = await access.service.from("businesses").select("default_currency")
    .eq("id", access.businessId).maybeSingle();
  if (!business?.default_currency) {
    return apiError("BUSINESS_CURRENCY_UNAVAILABLE", "The business currency configuration is unavailable.", 503);
  }
  const { data: existingKey } = await access.service.from("document_intake_idempotency_keys")
    .select("request_hash").eq("business_id", access.businessId).eq("action_scope", "create")
    .eq("idempotency_key", idempotency.key).maybeSingle();
  if (existingKey && existingKey.request_hash !== requestHash) {
    return apiError("IDEMPOTENCY_CONFLICT", "This idempotency key was already used for a different request.", 409);
  }
  const { data, error } = await access.service.rpc("document_intake_create", {
    p_business_id: access.businessId,
    p_actor_id: access.user.id,
    p_source: parsed.data.source,
    p_intended_workflow: parsed.data.intendedWorkflow,
    // Currency is resolved from the authorised business, never accepted as an
    // authoritative client field. Later extraction may only propose a change.
    p_currency_hint: business.default_currency,
    p_idempotency_key: idempotency.key,
    p_request_hash: requestHash,
    p_correlation_id: correlationId(request.headers),
  });
  if (error || !data) return databaseApiError(error?.message, "Unable to create the document draft.");

  const intake = data as DocumentIntakeRecord;
  const replayed = Boolean(existingKey);
  return apiJson({ intake: safeIntake(intake), idempotentReplay: replayed }, replayed ? 200 : 201);
}
