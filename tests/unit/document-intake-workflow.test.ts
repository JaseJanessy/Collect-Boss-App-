import { describe, expect, it } from "vitest";
import { findTransactionDuplicates, rankProfileMatches, workflowSubmissionError, type TransactionWorkflowDraft } from "@/lib/document-intake/workflow";

const baseDraft: TransactionWorkflowDraft = {
  step: "review_create", expectedVersion: 1, transactionNature: "loan_disbursement", amountMinor: 12500,
  currency: "MYR", profileDecision: { kind: "existing", customerId: "11111111-1111-4111-8111-111111111111" },
  dueDate: "2026-09-30", createCollectionCase: false, paymentMethod: "bank_transfer",
};

describe("transaction intake profile matching", () => {
  it("ranks strong identifiers ahead of names without auto-merging a similar name", () => {
    const matches = rankProfileMatches({ name: "Acme Sdn Bhd", email: "AR@ACME.TEST" }, [
      { id: "name-only", name: "Acme Sdn Bhd" },
      { id: "email", name: "Different", email: "ar@acme.test" },
    ]);
    expect(matches.map((match) => match.customerId)).toEqual(["email", "name-only"]);
    expect(matches[0].strongIdentifierMatch).toBe(true);
    expect(matches[1]).toMatchObject({ confidence: 0.45, strongIdentifierMatch: false });
  });

  it("supports provider mappings, registration IDs, normalized email, and phone", () => {
    const matches = rankProfileMatches({ externalProvider: "xero", externalCustomerId: "C-9", registrationNo: "2024-001" }, [{
      id: "customer", registrationNo: "2024001", externalMappings: [{ provider: "xero", externalCustomerId: "C-9" }],
    }]);
    expect(matches[0]).toMatchObject({ confidence: 1, strongIdentifierMatch: true });
    expect(matches[0].reasons).toHaveLength(2);
  });
});

describe("duplicate transaction review", () => {
  it("flags exact hashes and probable transaction tuples without merging anything", () => {
    const input = { key: "new", evidenceSha256: "abc", amountMinor: 5000, currency: "MYR", transactionDate: "2026-08-01", partyHint: "payer", documentKind: "receipt" };
    const matches = findTransactionDuplicates(input, [
      { ...input, key: "hash" },
      { ...input, key: "tuple", evidenceSha256: "different" },
    ]);
    expect(matches).toEqual([
      { candidateKey: "hash", confidence: "exact", reasons: ["Exact file SHA-256 match", "Amount, currency, date, party, and document type match"] },
      { candidateKey: "tuple", confidence: "probable", reasons: ["Amount, currency, date, party, and document type match"] },
    ]);
  });
});

describe("route requirements", () => {
  it("does not require an overdue case for a loan disbursement", () => {
    expect(workflowSubmissionError(baseDraft, 0)).toBeNull();
  });

  it("requires duplicate acknowledgement and linked records for repayments", () => {
    expect(workflowSubmissionError(baseDraft, 1)).toContain("duplicate");
    expect(workflowSubmissionError({ ...baseDraft, transactionNature: "partial_repayment", duplicateReview: { acknowledged: true, candidateKeys: ["evidence:1"], decision: "continue_separate" } }, 1)).toContain("obligation");
  });

  it("requires explicit profile creation and explicit case creation", () => {
    expect(workflowSubmissionError({ ...baseDraft, profileDecision: null }, 0)).toContain("profile");
    expect(workflowSubmissionError({ ...baseDraft, transactionNature: "collection_case", reference: "INV-1", createCollectionCase: false }, 0)).toContain("explicit");
  });
});
