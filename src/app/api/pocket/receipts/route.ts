import { NextRequest, NextResponse } from "next/server";

import { authorizePocketCapability, requirePocketBillingAccess } from "@/lib/billing/pocket-entitlements";
import { storeOriginalEvidence, type DocumentIntakeRecord } from "@/lib/document-intake/server";
import { correlationId, requestDigest } from "@/lib/document-intake/validation";
import { pocketReceiptSources } from "@/lib/pocket/receipts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };

export async function GET() {
  const access = await requirePocketBillingAccess("document_intake.read");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  const { data: intakes, error } = await access.service.from("document_intakes")
    .select("id,status,created_at,updated_at").eq("business_id", access.businessId)
    .eq("intended_workflow", "payment_evidence").is("deleted_at", null).order("updated_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: "Receipt drafts are temporarily unavailable." }, { status: 503, headers });
  const intakeIds = (intakes ?? []).map((item) => item.id);
  const [evidenceResult, linksResult] = await Promise.all([
    intakeIds.length ? access.service.from("evidence_files").select("intake_id,file_name,scan_status,processing_status,duplicate_match_status,uploaded_at")
      .eq("business_id", access.businessId).in("intake_id", intakeIds).eq("kind", "original").eq("is_current", true).is("soft_deleted_at", null) : Promise.resolve({ data: [], error: null }),
    intakeIds.length ? access.service.from("pocket_receipt_payment_links").select("intake_id,allocation_id,created_at")
      .eq("business_id", access.businessId).in("intake_id", intakeIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (evidenceResult.error || linksResult.error) return NextResponse.json({ error: "Receipt drafts are temporarily unavailable." }, { status: 503, headers });
  const evidence = new Map((evidenceResult.data ?? []).map((item) => [item.intake_id, item]));
  const links = new Map((linksResult.data ?? []).map((item) => [item.intake_id, item]));
  return NextResponse.json({ receipts: (intakes ?? []).map((item) => ({
    intakeId: item.id, status: links.has(item.id) ? "confirmed" : item.status,
    fileName: evidence.get(item.id)?.file_name ?? "Receipt",
    scanStatus: evidence.get(item.id)?.scan_status ?? null,
    processingStatus: evidence.get(item.id)?.processing_status ?? null,
    duplicateWarning: evidence.get(item.id)?.duplicate_match_status === "exact_hash_warning",
    allocationId: links.get(item.id)?.allocation_id ?? null,
    createdAt: item.created_at, updatedAt: item.updated_at,
  })) }, { headers });
}

export async function POST(request: NextRequest) {
  const access = await requirePocketBillingAccess("document_intake.create");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key || key.length < 8 || key.length > 96) return NextResponse.json({ error: "A valid retry key is required.", code: "IDEMPOTENCY_KEY_REQUIRED" }, { status: 400, headers });
  const authorization = await authorizePocketCapability({ access, capability: "pocket.receipt.process", operationKey: key });
  if ("error" in authorization) return NextResponse.json({ error: authorization.error, code: authorization.code }, { status: authorization.status, headers });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const source = form?.get("source");
  if (!(file instanceof File) || typeof source !== "string" || !pocketReceiptSources.includes(source as typeof pocketReceiptSources[number])) {
    return NextResponse.json({ error: "Choose a camera image, saved image, or PDF receipt." }, { status: 400, headers });
  }
  const sourceType = source as typeof pocketReceiptSources[number];
  const currency = String(access.business.default_currency ?? "").toUpperCase();
  if (!/^[A-Z]{3}$/u.test(currency)) return NextResponse.json({ error: "The workspace currency is unavailable." }, { status: 503, headers });
  const createHash = requestDigest({ source: "web_upload", intendedWorkflow: "payment_evidence", pocketSource: sourceType });
  const createKey = `capture:${key}`;
  const { data: intakeData, error: intakeError } = await access.service.rpc("document_intake_create", {
    p_business_id: access.businessId, p_actor_id: access.user.id, p_source: "web_upload", p_intended_workflow: "payment_evidence",
    p_currency_hint: currency, p_idempotency_key: createKey, p_request_hash: createHash, p_correlation_id: correlationId(request.headers),
  });
  if (intakeError || !intakeData) return NextResponse.json({ error: "The secure receipt draft could not be created." }, { status: 503, headers });
  const intake = intakeData as DocumentIntakeRecord;
  const upload = await storeOriginalEvidence({
    access, intake, file,
    documentKind: sourceType === "camera" ? "bank_in_cash_deposit_receipt" : sourceType === "image" ? "transaction_screenshot" : "payment_receipt",
    evidenceSource: sourceType === "pdf" ? "pdf" : sourceType === "camera" ? "bank_in_receipt" : "screenshot",
    rotationDegrees: 0, cropInsetPercent: 0, uploadSource: "web_upload", idempotencyKey: `upload:${key}`,
    correlation: correlationId(request.headers), actionScope: "upload",
  });
  if ("response" in upload) return upload.response;
  return NextResponse.json({
    intakeId: intake.id,
    evidence: { id: upload.record.id, fileName: upload.record.file_name, scanStatus: upload.record.scan_status, duplicateWarning: upload.record.duplicate_match_status === "exact_hash_warning" },
    idempotentReplay: upload.idempotent,
  }, { status: upload.idempotent ? 200 : 201, headers });
}
