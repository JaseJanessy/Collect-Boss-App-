import { NextRequest } from "next/server";
import { requireDocumentPermission } from "@/lib/document-intake/server";
import { readIdempotencyKey } from "@/lib/document-intake/validation";
import { matchingAccessError, matchingDatabaseError, matchingError, matchingJson } from "@/lib/payment-matching/api";
import { requestHash, reviewDecisionSchema } from "@/lib/payment-matching/validation";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ transactionId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function POST(request: NextRequest, context: Context) {
  const access = await requireDocumentPermission(request, "payment.approve");
  if ("error" in access) return matchingAccessError(access);
  const idempotency = readIdempotencyKey(request.headers);
  if ("error" in idempotency) return matchingError(idempotency.code, idempotency.error, 400);
  const { transactionId } = await context.params;
  if (!UUID.test(transactionId)) return matchingError("INVALID_TRANSACTION_ID", "The transaction identifier is invalid.", 400);
  const parsed = reviewDecisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return matchingError("INVALID_REVIEW", "Provide a valid approve, split approve, reject, or defer decision.", 400);
  const body = parsed.data;
  const allocations = body.decision === "approve_split" ? body.allocations : [];
  const splitAuthorization = body.decision === "approve_split" && body.splitAuthorization;
  const hash = requestHash({ transactionId, ...body });
  const { data, error } = await access.service.rpc("payment_matching_review_candidate", {
    p_business_id: access.businessId, p_transaction_id: transactionId, p_actor_id: access.user.id,
    p_decision: body.decision, p_candidate_id: body.candidateId, p_allocations: allocations,
    p_split_authorization: splitAuthorization, p_note: body.note ?? null,
    p_idempotency_key: idempotency.key, p_request_hash: hash,
  });
  if (error || !data) return matchingDatabaseError(error?.message, "Unable to record the candidate review.");
  return matchingJson(data as Record<string, unknown>);
}

