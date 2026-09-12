import { NextRequest, NextResponse } from "next/server";

import { authorizePocketCapability, requirePocketBillingAccess } from "@/lib/billing/pocket-entitlements";
import { correlationId, requestDigest } from "@/lib/document-intake/validation";
import { loadPocketReceiptWorkspace } from "@/lib/pocket/receipts-server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };
type Context = { params: Promise<{ intakeId: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const access = await requirePocketBillingAccess("document_intake.read");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  const { intakeId } = await context.params;
  try {
    const receipt = await loadPocketReceiptWorkspace(access, intakeId);
    if (!receipt) return NextResponse.json({ error: "Receipt draft not found.", code: "RECEIPT_NOT_FOUND" }, { status: 404, headers });
    return NextResponse.json({ receipt }, { headers });
  } catch {
    return NextResponse.json({ error: "Receipt review is temporarily unavailable. Confirm that the Prompt 6 migration is installed." }, { status: 503, headers });
  }
}

export async function POST(request: NextRequest, context: Context) {
  const access = await requirePocketBillingAccess("document_intake.create");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key || key.length < 8 || key.length > 96) return NextResponse.json({ error: "A valid retry key is required.", code: "IDEMPOTENCY_KEY_REQUIRED" }, { status: 400, headers });
  const authorization = await authorizePocketCapability({ access, capability: "pocket.receipt.process", operationKey: key });
  if ("error" in authorization) return NextResponse.json({ error: authorization.error, code: authorization.code }, { status: authorization.status, headers });
  const { intakeId } = await context.params;
  const { data: intake } = await access.service.from("document_intakes").select("id")
    .eq("id", intakeId).eq("business_id", access.businessId).eq("intended_workflow", "payment_evidence").is("deleted_at", null).maybeSingle();
  if (!intake) return NextResponse.json({ error: "Receipt draft not found.", code: "RECEIPT_NOT_FOUND" }, { status: 404, headers });
  const { data: evidence } = await access.service.from("evidence_files").select("id,scan_status")
    .eq("business_id", access.businessId).eq("intake_id", intakeId).eq("kind", "original").eq("is_current", true).is("soft_deleted_at", null).maybeSingle();
  if (!evidence) return NextResponse.json({ error: "Upload a receipt first.", code: "EVIDENCE_REQUIRED" }, { status: 409, headers });
  if (evidence.scan_status !== "clean") return NextResponse.json({ error: "The receipt is unavailable until security scanning completes.", code: "SCAN_PENDING" }, { status: 423, headers });
  const { data: latest } = await access.service.from("document_intake_extractions").select("id,status,error_code")
    .eq("business_id", access.businessId).eq("intake_id", intakeId).eq("evidence_id", evidence.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (latest && ["queued", "processing", "completed", "needs_review"].includes(latest.status)) {
    return NextResponse.json({ extraction: latest, idempotentReplay: true }, { status: latest.status === "queued" || latest.status === "processing" ? 202 : 200, headers });
  }
  const { data, error } = await access.service.rpc("document_intake_requeue_extraction", {
    p_business_id: access.businessId, p_intake_id: intakeId, p_actor_id: access.user.id,
    p_idempotency_key: `process:${key}`, p_request_hash: requestDigest({ intakeId, evidenceId: evidence.id, action: "pocket_receipt_process" }),
    p_correlation_id: correlationId(request.headers),
  });
  if (error || !data) {
    const quota = error?.message.includes("LIMIT_REACHED");
    const rate = error?.message.includes("P12_EXTRACTION_RATE_LIMITED");
    return NextResponse.json({
      error: quota ? "Your current-cycle receipt processing limit has been reached." : rate ? "Too many receipt processing requests. Try again later." : "Receipt processing could not be queued.",
      code: quota ? "LIMIT_REACHED" : rate ? "EXTRACTION_RATE_LIMITED" : "PROCESSING_FAILED",
    }, { status: quota || rate ? 429 : 503, headers });
  }
  return NextResponse.json({ extraction: data, idempotentReplay: false }, { status: 202, headers });
}
