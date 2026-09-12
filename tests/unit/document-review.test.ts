import { describe, expect, it } from "vitest";
import { buildReviewWorkspace, prepareDocumentReview, type ReviewExtraction } from "@/lib/document-intake/review";
import type { EvidenceLocation, StructuredExtraction } from "@/lib/document-intake/extraction/types";

const evidence = (snippet: string, page = 1): EvidenceLocation => ({
  source: "pdf_text_layer", page, imageId: null, snippet, textSpan: { start: 0, end: snippet.length },
});

function extraction(result?: Partial<StructuredExtraction>): ReviewExtraction {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    evidenceId: "22222222-2222-4222-8222-222222222222",
    extractionVersion: 2,
    documentVersion: 1,
    status: "needs_review",
    documentKind: "online_bank_transfer_receipt",
    classificationConfidence: 0.91,
    parserVersion: "p11-v1",
    provider: "native_pdf",
    providerModel: "native_pdf_text",
    providerVersion: "1",
    extractionMethod: "pdf_text_layer",
    completedAt: "2026-08-02T08:00:00.000Z",
    structuredResult: {
      document_kind: { value: "online_bank_transfer_receipt", confidence: 0.91 },
      amount_candidates: [
        { minor_units: 3_500_00, currency: "MYR", label: "transfer_amount", confidence: 0.91, evidence: evidence("Transfer amount RM 3,500.00"), recognized_string: "RM 3,500.00" },
        { minor_units: 18_420_70, currency: "MYR", label: "available_balance", confidence: 0.99, evidence: evidence("Available balance RM 18,420.70"), recognized_string: "RM 18,420.70" },
        { minor_units: 50, currency: "MYR", label: "fee", confidence: 0.99, evidence: evidence("Fee RM 0.50"), recognized_string: "RM 0.50" },
        { minor_units: 3_500_50, currency: "MYR", label: "total_debit", confidence: 0.95, evidence: evidence("Total debit RM 3,500.50"), recognized_string: "RM 3,500.50" },
      ],
      transaction_date_candidates: [{ value: "02/08/2026", confidence: 0.72, evidence: evidence("Date 02/08/2026") }],
      reference_candidates: [{ value: "REF-12345", confidence: 0.86, evidence: evidence("Reference REF-12345") }],
      bank_candidates: [{ value: "Maybank", confidence: 0.9, evidence: evidence("Maybank") }],
      sender_candidates: [], recipient_candidates: [], status_candidates: [], field_candidates: [],
      reconciliation: { available: false, reconciles: null, line_item_minor_units: null, total_minor_units: null, currency: null },
      warnings: ["AMBIGUOUS_DATE"], parser_version: "p11-v1",
      ...result,
    },
  };
}

describe("document human review", () => {
  it("presents every amount and recommends by label instead of choosing the largest number", () => {
    const workspace = buildReviewWorkspace(extraction());
    expect(workspace.amountCandidates).toHaveLength(4);
    expect(workspace.recommendedAmountCandidateId).toBe("amount:0");
    expect(workspace.amountCandidates.find((item) => item.label === "available_balance")?.recommended).toBe(false);
    expect(workspace.amountCandidates.find((item) => item.label === "fee")?.recommended).toBe(false);
    expect(workspace.amountCandidates.find((item) => item.label === "total_debit")?.recommended).toBe(false);
  });

  it("blocks currency, date, and transaction-nature ambiguity until a human confirms each field", () => {
    const prepared = prepareDocumentReview({
      documentKind: "online_bank_transfer_receipt",
      representsFinancialMovement: true,
      amount: { mode: "candidate", candidateId: "amount:0" },
      currency: "MYR",
    }, buildReviewWorkspace(extraction()), { confirm: true, supportedCurrencies: ["MYR"] });
    expect(prepared.review_status).toBe("draft");
    expect(prepared.validation_issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "CURRENCY_CONFIRMATION_REQUIRED", "DATE_REQUIRED", "DATE_CONFIRMATION_REQUIRED", "TRANSACTION_NATURE_REQUIRED",
    ]));
  });

  it("rejects a date-time without an explicit offset even when the user checks confirmation", () => {
    const prepared = prepareDocumentReview({
      documentKind: "online_bank_transfer_receipt", representsFinancialMovement: true,
      amount: { mode: "candidate", candidateId: "amount:0" }, currency: "MYR", currencyConfirmed: true,
      date: { mode: "candidate", candidateId: "date:0", interpretedDateTime: "2026-08-02T10:30:00", timezone: "Asia/Kuala_Lumpur", confirmed: true },
      transactionNature: "repayment",
    }, buildReviewWorkspace(extraction()), { confirm: true, supportedCurrencies: ["MYR"] });
    expect(prepared.validation_issues.map((issue) => issue.code)).toContain("INVALID_DATE");
    expect(prepared.review_status).toBe("draft");
  });

  it("stores a manual amount with its reason, original string, actor-ready decision metadata, and no fabricated citation", () => {
    const prepared = prepareDocumentReview({
      documentKind: "online_bank_transfer_receipt", representsFinancialMovement: true,
      amount: { mode: "manual", amountMinor: 349_900, recognizedValue: "RM 3,500.00", reason: "Receipt discount changes the transferred total." },
      currency: "MYR", currencyConfirmed: true,
      date: { mode: "candidate", candidateId: "date:0", interpretedDateTime: "2026-08-02T10:30:00+08:00", timezone: "Asia/Kuala_Lumpur", confirmed: true },
      transactionNature: "partial_repayment",
    }, buildReviewWorkspace(extraction()), { confirm: true, supportedCurrencies: ["MYR"] });
    expect(prepared.review_status).toBe("confirmed");
    expect(prepared.amount_minor).toBe(349_900);
    expect(prepared.chosen_amount_original).toBe("RM 3,500.00");
    expect(prepared.manual_amount_reason).toMatch(/discount/u);
    expect(prepared.field_decisions.amount).toMatchObject({ source: "manual", original_value: "RM 3,500.00", confirmed_value: 349_900 });
    expect(prepared.evidence_citations.some((item) => item.field === "amount")).toBe(false);
  });

  it("binds selected candidates to evidence citations and preserves the original reference", () => {
    const prepared = prepareDocumentReview({
      documentKind: "online_bank_transfer_receipt", representsFinancialMovement: true,
      amount: { mode: "candidate", candidateId: "amount:0" }, currency: "MYR", currencyConfirmed: true,
      date: { mode: "candidate", candidateId: "date:0", interpretedDateTime: "2026-08-02T10:30:00+08:00", timezone: "Asia/Kuala_Lumpur", confirmed: true },
      reference: { mode: "candidate", candidateId: "reference:0" }, transactionNature: "repayment",
    }, buildReviewWorkspace(extraction()), { confirm: true, supportedCurrencies: ["MYR"] });
    expect(prepared.review_status).toBe("confirmed");
    expect(prepared.chosen_amount_candidate_id).toBe("amount:0");
    expect(prepared.reference_original).toBe("REF-12345");
    expect(prepared.evidence_citations.map((item) => item.field)).toEqual(expect.arrayContaining(["amount", "date", "reference"]));
  });

  it("requires a reason and preserves the old value for a manual extracted-field correction", () => {
    const base = {
      documentKind: "online_bank_transfer_receipt" as const, representsFinancialMovement: true,
      amount: { mode: "candidate" as const, candidateId: "amount:0" }, currency: "MYR", currencyConfirmed: true,
      date: { mode: "candidate" as const, candidateId: "date:0", interpretedDateTime: "2026-08-02T10:30:00+08:00", timezone: "Asia/Kuala_Lumpur", confirmed: true },
      transactionNature: "repayment" as const,
    };
    const workspace = buildReviewWorkspace(extraction());
    const missingReason = prepareDocumentReview({ ...base, reference: { mode: "manual", value: "REF-54321" } }, workspace, { confirm: true, supportedCurrencies: ["MYR"] });
    expect(missingReason.review_status).toBe("draft");
    expect(missingReason.validation_issues.map((issue) => issue.code)).toContain("MANUAL_REASON_REQUIRED");

    const corrected = prepareDocumentReview({ ...base, reference: { mode: "manual", value: "REF-54321", reason: "The OCR transposed two digits." } }, workspace, { confirm: true, supportedCurrencies: ["MYR"] });
    expect(corrected.review_status).toBe("confirmed");
    expect(corrected.field_decisions.reference).toMatchObject({
      source: "manual", original_value: "REF-12345", confirmed_value: "REF-54321", reason: "The OCR transposed two digits.",
    });
  });

  it("does not require transaction fields for a document confirmed as non-financial", () => {
    const prepared = prepareDocumentReview({ documentKind: "invoice", representsFinancialMovement: false }, buildReviewWorkspace(extraction({ document_kind: { value: "invoice", confidence: 0.95 } })), { confirm: true, supportedCurrencies: ["MYR"] });
    expect(prepared.review_status).toBe("confirmed");
    expect(prepared.amount_minor).toBeNull();
    expect(prepared.transaction_nature).toBeNull();
  });
});
