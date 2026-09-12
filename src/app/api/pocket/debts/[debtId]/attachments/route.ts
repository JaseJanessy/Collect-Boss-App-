import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { appendSensitiveAudit } from "@/lib/auth/tenant-access";
import { authorizePocketCapability, requirePocketBillingAccess } from "@/lib/billing/pocket-entitlements";
import { storeOriginalEvidence, type DocumentIntakeRecord } from "@/lib/document-intake/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST(request: NextRequest, context: { params: Promise<{ debtId: string }> }) {
  const access = await requirePocketBillingAccess("case.manage");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  const authorization = await authorizePocketCapability({ access, capability: "pocket.debt.manage" });
  if ("error" in authorization) return NextResponse.json({ error: authorization.error, code: authorization.code }, { status: authorization.status, headers });
  const { debtId } = await context.params;
  const { data: debt } = await access.service.from("obligations").select("id").eq("id", debtId).eq("business_id", access.businessId).eq("origin_product_type", "pocket").maybeSingle();
  if (!debt) return NextResponse.json({ error: "Debt not found." }, { status: 404, headers });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a PDF, JPG, PNG, or HEIC attachment." }, { status: 400, headers });
  const idempotencyKey = `pocket-debt:${debtId}:${crypto.randomUUID()}`;
  const requestHash = createHash("sha256").update(JSON.stringify({ debtId, fileName:file.name, size:file.size, type:file.type })).digest("hex");
  const { data: intakeData, error: intakeError } = await access.service.rpc("document_intake_create", {
    p_business_id: access.businessId, p_actor_id: access.user.id, p_source: "web_upload", p_intended_workflow: "general_document",
    p_currency_hint: String(access.business.default_currency ?? "MYR"), p_idempotency_key: idempotencyKey,
    p_request_hash: requestHash, p_correlation_id: crypto.randomUUID(),
  });
  if (intakeError || !intakeData) return NextResponse.json({ error: "The secure attachment draft could not be created." }, { status: 503, headers });
  const intake = intakeData as unknown as DocumentIntakeRecord;
  const upload = await storeOriginalEvidence({
    access, intake, file, documentKind: "unknown_or_other", evidenceSource: file.type === "application/pdf" ? "pdf" : "other_image",
    rotationDegrees: 0, cropInsetPercent: 0, uploadSource: "web_upload", idempotencyKey: `${idempotencyKey}:upload`,
    correlation: crypto.randomUUID(), actionScope: "upload",
  });
  if ("response" in upload) return upload.response;
  const { error } = await access.service.from("pocket_debt_attachments").insert({ business_id: access.businessId, debt_id: debtId, evidence_id: upload.record.id, created_by: access.user.id });
  if (error) return NextResponse.json({ error: "The file was stored but could not be linked to this debt. Contact support with the debt reference." }, { status: 503, headers });
  await appendSensitiveAudit({ access, request, action: "pocket.debt.attachment_added", entityType: "obligation", entityId: debtId, metadata: { evidence_id: upload.record.id, file_name: upload.record.file_name } });
  return NextResponse.json({ attachment: { id: upload.record.id, fileName: upload.record.file_name, scanStatus: upload.record.scan_status } }, { status: 201, headers });
}
