import { describe, expect, it } from "vitest";
import {
  industryNeedsAdditionalReview,
  isCollectBossVerified,
  verificationDisplayLabel,
} from "@/lib/business-profile/risk";

describe("business verification presentation", () => {
  it("labels only the exact reviewed state as verified", () => {
    expect(isCollectBossVerified("verified")).toBe(true);
    for (const state of ["unverified", "pending", "rejected", "restricted"] as const) {
      expect(isCollectBossVerified(state)).toBe(false);
      expect(verificationDisplayLabel(state)).not.toMatch(/^Verified/);
    }
  });

  it("applies additional review only to configured higher-risk industry groups", () => {
    expect(industryNeedsAdditionalReview("financing_money_lending")).toBe(true);
    expect(industryNeedsAdditionalReview("financial_services")).toBe(true);
    expect(industryNeedsAdditionalReview("general")).toBe(false);
    expect(industryNeedsAdditionalReview("retail")).toBe(false);
  });
});
