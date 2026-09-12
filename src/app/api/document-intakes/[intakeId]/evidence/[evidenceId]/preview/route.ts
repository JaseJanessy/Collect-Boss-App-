import { NextRequest } from "next/server";
import { apiError, apiJson, authApiError } from "@/lib/document-intake/api";
import { requireDocumentPermission, scopedIntake } from "@/lib/document-intake/server";
import { DOCUMENT_EVIDENCE_BUCKET } from "@/lib/document-intake/validation";
import { secureStoredFileResponse } from "@/lib/security/secure-file-response";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ intakeId: string; evidenceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  const access = await requireDocumentPermission(request, "document_intake.read");
  if ("error" in access) return authApiError(access);
  const { intakeId, evidenceId } = await context.params;
  if (!await scopedIntake(access, intakeId)) return apiError("INTAKE_NOT_FOUND", "Document draft not found.", 404);
  const { data: evidence } = await access.service.from("evidence_files")
    .select("id,file_name,object_path,storage_bucket,scan_status")
    .eq("id", evidenceId).eq("business_id", access.businessId).eq("intake_id", intakeId)
    .is("soft_deleted_at", null).maybeSingle();
  if (!evidence) return apiError("EVIDENCE_NOT_FOUND", "Evidence file not found.", 404);
  if (evidence.scan_status !== "clean") {
    return apiError("EVIDENCE_SCAN_PENDING", "Evidence is unavailable until security scanning completes.", 423);
  }
  if (evidence.storage_bucket !== DOCUMENT_EVIDENCE_BUCKET || !evidence.object_path) {
    return apiError("EVIDENCE_UNAVAILABLE", "Evidence storage is unavailable.", 410);
  }
  const { data: derivative } = await access.service.from("evidence_files")
    .select("object_path,storage_bucket")
    .eq("business_id", access.businessId).eq("intake_id", intakeId)
    .eq("parent_evidence_id", evidenceId).eq("kind", "derived").is("soft_deleted_at", null).maybeSingle();
  const previewObjectPath = derivative?.storage_bucket === DOCUMENT_EVIDENCE_BUCKET && derivative.object_path
    ? derivative.object_path : evidence.object_path;
  const download = request.nextUrl.searchParams.get("mode") === "download";
  if (request.nextUrl.searchParams.get("serve") !== "1") {
    const url = `/api/document-intakes/${encodeURIComponent(intakeId)}/evidence/${encodeURIComponent(evidenceId)}/preview?mode=${download ? "download" : "preview"}&serve=1`;
    return apiJson({ url, expiresInSeconds: 0, mode: download ? "download" : "preview",
      derivative: !download && previewObjectPath !== evidence.object_path });
  }
  const objectPath = download ? evidence.object_path : previewObjectPath;
  if (!objectPath.startsWith(`${access.businessId}/${intakeId}/${evidenceId}/`)) {
    return apiError("EVIDENCE_SCOPE_INVALID", "Evidence storage scope is invalid.", 410);
  }
  const { data: blob, error } = await access.service.storage.from(DOCUMENT_EVIDENCE_BUCKET).download(objectPath);
  if (error || !blob) return apiError("EVIDENCE_DOWNLOAD_FAILED", "Unable to open evidence.", 502);
  return secureStoredFileResponse({ blob, filename: evidence.file_name, download, contentType: blob.type });
}
