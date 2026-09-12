import { describe, expect, it } from "vitest";
import { queueForCandidates, rankPaymentCandidates } from "@/lib/payment-matching/engine";
import { matchingSettingsSchema, normalizedTransactionBatchSchema, reviewDecisionSchema } from "@/lib/payment-matching/validation";
import { labelledPaymentMatchingFixtures } from "../fixtures/payment-matching-labelled";

describe("payment matching boundary integration", () => {
  it("accepts all supported normalized sources and rejects non-integer money", () => {
    for (const sourceType of ["bank_statement", "accounting", "manual", "payment_proof"] as const) {
      expect(normalizedTransactionBatchSchema.safeParse({ transactions: [{
        sourceType, sourceSystem: "fixture", sourceRecordId: `${sourceType}-1`, amountMinor: 12_345,
        currency: "myr", phoneMatchPermitted: false, duplicateSignals: [], metadata: {},
      }] }).success).toBe(true);
    }
    expect(normalizedTransactionBatchSchema.safeParse({ transactions: [{
      sourceType: "manual", sourceSystem: "fixture", sourceRecordId: "bad", amountMinor: 12.34, currency: "MYR",
    }] }).success).toBe(false);
  });

  it("keeps ambiguous and unmatched results balance-neutral until review", () => {
    const equalAmountOnly = labelledPaymentMatchingFixtures[1];
    const candidates = rankPaymentCandidates(equalAmountOnly.transaction, equalAmountOnly.targets);
    expect(queueForCandidates(candidates)).toBe("unmatched");
    expect(candidates.every((candidate) => candidate.confidenceBand === "low")).toBe(true);
  });

  it("requires explicit, exact split authorization input", () => {
    expect(reviewDecisionSchema.safeParse({
      decision: "approve_split", candidateId: "11111111-1111-4111-8111-111111111111",
      note: "Authorized across two invoices", splitAuthorization: true,
      allocations: [
        { candidateId: "11111111-1111-4111-8111-111111111111", amountMinor: 5_000 },
        { candidateId: "22222222-2222-4222-8222-222222222222", amountMinor: 5_000 },
      ],
    }).success).toBe(true);
    expect(reviewDecisionSchema.safeParse({
      decision: "approve_split", candidateId: "11111111-1111-4111-8111-111111111111",
      note: "Missing authorization", splitAuthorization: false, allocations: [],
    }).success).toBe(false);
  });

  it("enforces safe tenant threshold separation", () => {
    expect(matchingSettingsSchema.safeParse({ highConfidence: 75, ambiguous: 45, dateWindowDays: 14, maximumCandidates: 10 }).success).toBe(true);
    expect(matchingSettingsSchema.safeParse({ highConfidence: 70, ambiguous: 69, dateWindowDays: 14, maximumCandidates: 10 }).success).toBe(false);
  });
});

