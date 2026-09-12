import { NextRequest, NextResponse } from "next/server";
import { enforcePublicRateLimit, publicRateLimitResponse } from "@/lib/api/public-rate-limit";
import { getPublicActionContext } from "@/lib/public-access/service";
import { parseCurrencyToMinor } from "@/lib/financial/money";
import { validateEvidenceUpload } from "@/lib/evidence/validation";
import { getServiceClient } from "@/lib/supabase/service-client";
import type { DisputeCategory, DisputeRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const categories = new Set<DisputeCategory>([
  "amount_incorrect", "already_paid", "duplicate_invoice", "goods_not_received",
  "damaged_quality_issue", "service_incomplete", "incorrect_pricing",
  "do_not_recognise_debt", "other",
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rateLimit = await enforcePublicRateLimit({ headers: request.headers, rawToken: token, action: "dispute", limit: 8, windowSeconds: 300 });
  if (!rateLimit.allowed) return publicRateLimitResponse(rateLimit);
  const access = await getPublicActionContext(token, "payment");
  if (access.state !== "valid") return response({ error: "Payment link is unavailable." }, access.state === "unavailable" ? 503 : 404);
  const form = await request.formData();
  const category = form.get("category");
  const amount = form.get("amount");
  const obligationId = form.get("obligationId");
  const reason = form.get("reason");
  const description = form.get("description");
  const idempotencyKey = form.get("idempotencyKey");
  const evidence = form.get("evidence");
  if (typeof category !== "string" || !categories.has(category as DisputeCategory)
    || typeof reason !== "string" || !reason.trim() || reason.length > 300
    || typeof description !== "string" || description.trim().length < 5 || description.length > 2000
    || typeof idempotencyKey !== "string" || !uuidPattern.test(idempotencyKey)
    || (typeof obligationId === "string" && obligationId && !uuidPattern.test(obligationId))) {
    return response({ error: "Enter valid dispute details." }, 400);
  }
  let amountMinor: bigint;
  try {
    if (typeof amount !== "string") throw new Error("invalid");
    amountMinor = parseCurrencyToMinor(amount, access.caseScope.currency);
  } catch {
    return response({ error: "Enter a valid disputed amount." }, 400);
  }
  const service = await getServiceClient();
  if (!service) return response({ error: "Dispute service is unavailable." }, 503);
  const disputeId = crypto.randomUUID();
  let objectPath: string | null = null;
  let validated: { extension: string; sha256: string } | null = null;
  if (evidence instanceof File && evidence.size > 0) {
    const bytes = new Uint8Array(await evidence.arrayBuffer());
    const result = validateEvidenceUpload(evidence, bytes);
    if ("error" in result) return response({ error: result.error }, 400);
    validated = result;
    objectPath = `${access.caseScope.business_id}/${access.caseScope.id}/${disputeId}/${crypto.randomUUID()}.${result.extension}`;
    const { error } = await service.storage.from("dispute-evidence").upload(objectPath, evidence, {
      cacheControl: "3600", contentType: evidence.type, upsert: false,
    });
    if (error) return response({ error: "Unable to upload dispute evidence." }, 503);
  }
  const { data, error } = await service.rpc("dispute_submit_public", {
    p_dispute_id: disputeId,
    p_public_access_token_id: access.token.id,
    p_obligation_id: typeof obligationId === "string" && obligationId ? obligationId : null,
    p_category: category as DisputeCategory,
    p_disputed_amount_minor: amountMinor.toString(),
    p_reason: reason.trim(),
    p_description: description.trim(),
    p_idempotency_key: idempotencyKey,
    p_file_name: evidence instanceof File && evidence.size > 0 ? evidence.name : null,
    p_object_path: objectPath,
    p_content_type: evidence instanceof File && evidence.size > 0 ? evidence.type : null,
    p_size_bytes: evidence instanceof File && evidence.size > 0 ? String(evidence.size) : null,
    p_content_sha256: validated?.sha256 ?? null,
  });
  if (error || !data) {
    if (objectPath) await service.storage.from("dispute-evidence").remove([objectPath]);
    return response({ error: error?.message ?? "Unable to submit dispute." }, 409);
  }
  return response({ dispute: data as DisputeRow }, 201);
}
