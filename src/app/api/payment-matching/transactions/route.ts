import { NextRequest } from "next/server";
import { requireDocumentPermission } from "@/lib/document-intake/server";
import { readIdempotencyKey } from "@/lib/document-intake/validation";
import { matchingAccessError, matchingDatabaseError, matchingError, matchingJson } from "@/lib/payment-matching/api";
import { normalizedTransactionBatchSchema, requestHash, transactionFingerprint } from "@/lib/payment-matching/validation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await requireDocumentPermission(request, "payment.approve");
  if ("error" in access) return matchingAccessError(access);
  const requestedQueue = request.nextUrl.searchParams.get("queue") ?? "high_confidence_review";
  if (!["ready", "high_confidence_review", "ambiguous", "unmatched", "allocated", "all"].includes(requestedQueue)) {
    return matchingError("INVALID_QUEUE", "Choose a valid payment matching queue.", 400);
  }
  let query = access.service.from("normalized_payment_transactions")
    .select("id,source_type,source_system,source_record_id,source_batch_key,amount_minor,currency,occurred_at,reference,invoice_number,party_name,account_reference,duplicate_signals,queue_status,created_at")
    .eq("business_id", access.businessId).order("created_at", { ascending: false }).limit(100);
  if (requestedQueue !== "all") query = query.eq("queue_status", requestedQueue);
  const { data: transactions, error } = await query;
  if (error) return matchingError("QUEUE_LOAD_FAILED", "Unable to load the payment matching queue.", 500);
  const ids = (transactions ?? []).map((row) => String(row.id));
  const { data: candidates, error: candidateError } = ids.length
    ? await access.service.from("payment_match_candidates")
      .select("id,transaction_id,rank,score,confidence_band,customer_id,account_id,obligation_id,case_id,existing_payment_id,matched_signals,conflicting_signals,reason,ranking_reason,review_status,reviewed_at,review_note,created_at")
      .eq("business_id", access.businessId).in("transaction_id", ids).order("rank", { ascending: true })
    : { data: [], error: null };
  if (candidateError) return matchingError("QUEUE_LOAD_FAILED", "Unable to load candidate explanations.", 500);
  return matchingJson({ transactions: transactions ?? [], candidates: candidates ?? [], queue: requestedQueue });
}

export async function POST(request: NextRequest) {
  const access = await requireDocumentPermission(request, "payment.approve");
  if ("error" in access) return matchingAccessError(access);
  const idempotency = readIdempotencyKey(request.headers);
  if ("error" in idempotency) return matchingError(idempotency.code, idempotency.error, 400);
  const parsed = normalizedTransactionBatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return matchingError("INVALID_TRANSACTION_IMPORT", "Provide 1 to 500 valid normalized transactions.", 400);
  const transactions = parsed.data.transactions.map((transaction) => ({
    ...transaction,
    fingerprintHash: transactionFingerprint(transaction),
  }));
  const hash = requestHash(transactions);
  const { data, error } = await access.service.rpc("payment_matching_import_transactions", {
    p_business_id: access.businessId, p_actor_id: access.user.id, p_transactions: transactions,
    p_idempotency_key: idempotency.key, p_request_hash: hash,
  });
  if (error || !data) return matchingDatabaseError(error?.message, "Unable to import normalized payment transactions.");
  return matchingJson(data as Record<string, unknown>, 201);
}

