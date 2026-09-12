import { NextRequest, NextResponse } from "next/server";

import { authorizePocketCapability, requirePocketBillingAccess } from "@/lib/billing/pocket-entitlements";
import { prepareDocumentReview, type ReviewChoice, type ReviewTextCandidate } from "@/lib/document-intake/review";
import { correlationId, requestDigest } from "@/lib/document-intake/validation";
import { parseCurrencyToMinor } from "@/lib/financial/money";
import { pocketReceiptReviewSchema } from "@/lib/pocket/receipts";
import { loadPocketReceiptWorkspace } from "@/lib/pocket/receipts-server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };
type Context = { params: Promise<{ intakeId: string }> };

function textChoice(input: { value?: string | null; candidateId?: string | null; reason?: string | null; candidates: ReviewTextCandidate[] }): ReviewChoice | null {
  const value = input.value?.trim() || null;
  if (!value) return null;
  const candidate = input.candidateId ? input.candidates.find((item) => item.candidateId === input.candidateId) : null;
  return candidate && candidate.value === value
    ? { mode: "candidate", candidateId: candidate.candidateId }
    : { mode: "manual", value, reason: input.reason?.trim() || (input.candidates.length ? undefined : "No readable candidate was available.") };
}

export async function PATCH(request: NextRequest, context: Context) {
  const access = await requirePocketBillingAccess("document_intake.create");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key || key.length < 8 || key.length > 96) return NextResponse.json({ error: "A valid retry key is required.", code: "IDEMPOTENCY_KEY_REQUIRED" }, { status: 400, headers });
  const parsed = pocketReceiptReviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the highlighted receipt fields.", issues: parsed.error.flatten().fieldErrors }, { status: 400, headers });
  const authorization = await authorizePocketCapability({ access, capability: "pocket.receipt.process", operationKey: key });
  if ("error" in authorization) return NextResponse.json({ error: authorization.error, code: authorization.code }, { status: authorization.status, headers });
  const { intakeId } = await context.params;
  let receipt: Awaited<ReturnType<typeof loadPocketReceiptWorkspace>>;
  try { receipt = await loadPocketReceiptWorkspace(access, intakeId); }
  catch { return NextResponse.json({ error: "Receipt review is temporarily unavailable." }, { status: 503, headers }); }
  if (!receipt) return NextResponse.json({ error: "Receipt draft not found." }, { status: 404, headers });
  if (!receipt.evidence || receipt.evidence.scanStatus !== "clean" || !receipt.extraction || !["completed", "needs_review"].includes(receipt.extraction.status)) {
    return NextResponse.json({ error: "Wait for receipt processing to finish.", code: "EXTRACTION_PENDING" }, { status: 409, headers });
  }
  const currency = receipt.business.defaultCurrency.toUpperCase();
  let amountMinor: bigint;
  try { amountMinor = parseCurrencyToMinor(parsed.data.amount, currency); }
  catch (cause) { return NextResponse.json({ error: cause instanceof Error ? cause.message : "Enter a valid payment amount." }, { status: 400, headers }); }
  if (amountMinor <= 0n || amountMinor > BigInt(Number.MAX_SAFE_INTEGER)) return NextResponse.json({ error: "Enter a valid positive payment amount." }, { status: 400, headers });
  const amountCandidate = parsed.data.amountCandidateId ? receipt.workspace.amountCandidates.find((item) => item.candidateId === parsed.data.amountCandidateId) : null;
  const amount = amountCandidate && amountCandidate.minorUnits === Number(amountMinor) && amountCandidate.currency === currency
    ? { mode: "candidate" as const, candidateId: amountCandidate.candidateId }
    : { mode: "manual" as const, amountMinor: Number(amountMinor), recognizedValue: parsed.data.amount,
      reason: parsed.data.amountCorrectionReason?.trim() || (receipt.workspace.amountCandidates.length ? undefined : "No readable amount candidate was available.") };
  const dateCandidate = parsed.data.dateCandidateId ? receipt.workspace.dateCandidates.find((item) => item.candidateId === parsed.data.dateCandidateId) : null;
  const review = prepareDocumentReview({
    documentKind: parsed.data.documentKind,
    documentKindReason: parsed.data.documentKindReason,
    representsFinancialMovement: true,
    amount,
    currency,
    currencyConfirmed: true,
    date: dateCandidate
      ? { mode: "candidate", candidateId: dateCandidate.candidateId, interpretedDateTime: `${parsed.data.paymentDate}T12:00:00Z`, timezone: receipt.business.timezone, confirmed: true }
      : { mode: "manual", interpretedDateTime: `${parsed.data.paymentDate}T12:00:00Z`, timezone: receipt.business.timezone, confirmed: true,
        reason: parsed.data.dateCorrectionReason?.trim() || (receipt.workspace.dateCandidates.length ? undefined : "No readable date candidate was available.") },
    reference: textChoice({ value: parsed.data.reference, candidateId: parsed.data.referenceCandidateId, reason: parsed.data.referenceCorrectionReason, candidates: receipt.workspace.referenceCandidates }),
    bank: textChoice({ value: parsed.data.bank, candidateId: parsed.data.bankCandidateId, reason: parsed.data.bankCorrectionReason, candidates: receipt.workspace.bankCandidates }),
    sender: textChoice({ value: parsed.data.payerHint, candidateId: parsed.data.payerCandidateId, reason: parsed.data.payerCorrectionReason, candidates: receipt.workspace.senderCandidates }),
    recipient: null,
    transactionStatus: "successful",
    transactionNature: "repayment",
    notes: parsed.data.notes,
  }, receipt.workspace, { confirm: true, supportedCurrencies: [currency] });
  if (review.validation_issues.length) return NextResponse.json({
    error: "Review the corrected receipt fields before continuing.", code: "REVIEW_INCOMPLETE", issues: review.validation_issues,
  }, { status: 422, headers });
  const { data, error } = await access.service.rpc("document_intake_save_review", {
    p_business_id: access.businessId, p_intake_id: intakeId, p_actor_id: access.user.id, p_action: "confirm", p_review: review,
    p_idempotency_key: `review:${key}`, p_request_hash: requestDigest({ intakeId, action: "pocket_receipt_review", review }),
    p_correlation_id: correlationId(request.headers),
  });
  if (error || !data) return NextResponse.json({ error: error?.message.includes("P8_IDEMPOTENCY_CONFLICT") ? "This retry key was used for different receipt details." : "The reviewed receipt could not be saved." }, { status: error?.message.includes("P8_IDEMPOTENCY_CONFLICT") ? 409 : 503, headers });
  return NextResponse.json({ review: data, readyToConfirm: true }, { headers });
}
