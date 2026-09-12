import { NextRequest } from "next/server";
import { apiError, apiJson, authApiError } from "@/lib/document-intake/api";
import { requireDocumentPermission, safeEvidence, scopedIntake, storeOriginalEvidence, type IntakeEvidenceRecord } from "@/lib/document-intake/server";
import { correlationId, readIdempotencyKey, uploadMetadataSchema } from "@/lib/document-intake/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ intakeId: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const access = await requireDocumentPermission(_request, "document_intake.read");
  if ("error" in access) return authApiError(access);
  const { intakeId } = await context.params;
  if (!await scopedIntake(access, intakeId)) return apiError("INTAKE_NOT_FOUND", "Document draft not found.", 404);
  const { data, error } = await access.service.from("evidence_files").select("*")
    .eq("business_id", access.businessId).eq("intake_id", intakeId).is("soft_deleted_at", null)
    .eq("kind", "original")
    .order("evidence_version", { ascending: false });
  if (error) return apiError("EVIDENCE_LIST_FAILED", "Unable to load intake evidence.", 500);
  return apiJson({ evidence: ((data ?? []) as IntakeEvidenceRecord[]).map(safeEvidence) });
}

export async function POST(request: NextRequest, context: Context) {
  const access = await requireDocumentPermission(request, "document_intake.create");
  if ("error" in access) return authApiError(access);
  const idempotency = readIdempotencyKey(request.headers);
  if ("error" in idempotency) return apiError(idempotency.code, idempotency.error, 400);
  const { intakeId } = await context.params;
  const intake = await scopedIntake(access, intakeId);
  if (!intake) return apiError("INTAKE_NOT_FOUND", "Document draft not found.", 404);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const metadata = uploadMetadataSchema.safeParse({
    documentKind: form?.get("documentKind"),
    uploadSource: form?.get("uploadSource"),
    evidenceSource: form?.get("evidenceSource"),
    rotationDegrees: form?.get("rotationDegrees") ?? "0",
    cropInsetPercent: form?.get("cropInsetPercent") ?? "0",
  });
  if (!(file instanceof File) || !metadata.success) return apiError("INVALID_EVIDENCE_UPLOAD", "A valid file and upload metadata are required.", 400);
  const result = await storeOriginalEvidence({
    access,
    intake,
    file,
    documentKind: metadata.data.documentKind,
    evidenceSource: metadata.data.evidenceSource,
    rotationDegrees: metadata.data.rotationDegrees,
    cropInsetPercent: metadata.data.cropInsetPercent,
    uploadSource: metadata.data.uploadSource,
    idempotencyKey: idempotency.key,
    correlation: correlationId(request.headers),
    actionScope: "upload",
  });
  if ("response" in result) return result.response;
  return apiJson({ evidence: safeEvidence(result.record), idempotentReplay: result.idempotent }, result.idempotent ? 200 : 201);
}
