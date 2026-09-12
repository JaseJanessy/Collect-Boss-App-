import { describe, expect, it } from "vitest";
import { defaultMatchingThresholds, evaluatePaymentMatching, queueForCandidates, rankPaymentCandidates } from "@/lib/payment-matching/engine";
import { labelledPaymentMatchingFixtures } from "../fixtures/payment-matching-labelled";

describe("deterministic payment matching", () => {
  it("ranks explainable candidates and explains why alternatives rank lower", () => {
    const example = labelledPaymentMatchingFixtures[0];
    const candidates = rankPaymentCandidates(example.transaction, example.targets);
    expect(candidates[0]).toMatchObject({ targetKey: "right", rank: 1, confidenceBand: "high" });
    expect(candidates[0].matchedSignals.map((signal) => signal.code)).toEqual(expect.arrayContaining(["invoice_exact", "reference_invoice_exact", "amount_outstanding_exact"]));
    expect(candidates[0].reason).toContain("No conflicting signals");
    expect(candidates[0].rankingReason).toContain("next alternative scored");
    expect(candidates[1].rankingReason).toContain("below the leading alternative");
  });

  it("never treats equal amount and currency alone as an actionable candidate", () => {
    const example = labelledPaymentMatchingFixtures[1];
    const candidates = rankPaymentCandidates(example.transaction, example.targets);
    expect(candidates[0].score).toBe(35);
    expect(candidates[0].confidenceBand).toBe("low");
    expect(queueForCandidates(candidates)).toBe("unmatched");
  });

  it("records conflicts without using fraud language", () => {
    const example = labelledPaymentMatchingFixtures[2];
    const candidate = rankPaymentCandidates(example.transaction, example.targets)[0];
    expect(candidate.conflictingSignals.map((signal) => signal.code)).toContain("currency_conflict");
    expect(JSON.stringify(candidate)).not.toMatch(/fraud/iu);
  });

  it("reports fixture precision and recall by confidence band without production claims", () => {
    const report = evaluatePaymentMatching(labelledPaymentMatchingFixtures, defaultMatchingThresholds);
    expect(report.high.predicted).toBeGreaterThan(0);
    expect(report.high.precision).toBe(1);
    expect(report.high.recall).toBe(1);
    expect(Object.keys(report)).toEqual(["high", "ambiguous", "low"]);
  });
});
