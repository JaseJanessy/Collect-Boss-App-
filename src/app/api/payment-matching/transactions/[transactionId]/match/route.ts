import { NextRequest } from "next/server";
import { requireDocumentPermission } from "@/lib/document-intake/server";
import { readIdempotencyKey } from "@/lib/document-intake/validation";
import { matchingAccessError, matchingDatabaseError, matchingError, matchingJson } from "@/lib/payment-matching/api";
import { queueForCandidates, rankPaymentCandidates } from "@/lib/payment-matching/engine";
import { loadMatchingSettings, loadNormalizedTransaction, loadPaymentMatchTargets } from "@/lib/payment-matching/server";
import { requestHash } from "@/lib/payment-matching/validation";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ transactionId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ALGORITHM_VERSION = "deterministic-weighted-v1";

export async function POST(request: NextRequest, context: Context) {
  const access = await requireDocumentPermission(request, "payment.approve");
  if ("error" in access) return matchingAccessError(access);
  const idempotency = readIdempotencyKey(request.headers);
  if ("error" in idempotency) return matchingError(idempotency.code, idempotency.error, 400);
  const { transactionId } = await context.params;
  if (!UUID.test(transactionId)) return matchingError("INVALID_TRANSACTION_ID", "The transaction identifier is invalid.", 400);
  const transaction = await loadNormalizedTransaction(access, transactionId);
  if (!transaction) return matchingError("TRANSACTION_NOT_FOUND", "The normalized transaction was not found.", 404);
  if (transaction.row.queue_status === "allocated") return matchingError("TRANSACTION_ALREADY_ALLOCATED", "This transaction already has an approved allocation.", 409);
  try {
    const [settings, targets] = await Promise.all([loadMatchingSettings(access), loadPaymentMatchTargets(access)]);
    const candidates = rankPaymentCandidates(transaction.normalized, targets, settings);
    const queue = queueForCandidates(candidates, settings);
    const hash = requestHash({ transactionId, algorithm: ALGORITHM_VERSION, settings, transaction: transaction.normalized });
    const { data: job, error } = await access.service.rpc("payment_matching_store_job", {
      p_business_id: access.businessId, p_transaction_id: transactionId, p_actor_id: access.user.id,
      p_algorithm_version: ALGORITHM_VERSION, p_thresholds: settings, p_queue_result: queue,
      p_candidates: candidates, p_idempotency_key: idempotency.key, p_request_hash: hash,
    });
    if (error || !job) return matchingDatabaseError(error?.message, "Unable to persist payment match candidates.");
    return matchingJson({ job, queue, candidates });
  } catch {
    return matchingError("MATCHING_INPUT_UNAVAILABLE", "Unable to load eligible cases and invoices for matching.", 500);
  }
}

