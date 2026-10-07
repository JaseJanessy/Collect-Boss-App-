import { describe, expect, it } from "vitest";
import { recommendProduct } from "@/lib/onboarding/product-quiz";

describe("product quiz", () => {
  it("recommends Pocket for a solo owner who wants quick tracking", () => {
    expect(recommendProduct({ customers: "under_20", team: "just_me", need: "quick_tracking" }).product).toBe("pocket");
    expect(recommendProduct({ customers: "20_to_100", team: "just_me", need: "quick_tracking" }).product).toBe("pocket");
  });

  it.each([
    { customers: "under_20", team: "with_staff", need: "quick_tracking" },
    { customers: "over_100", team: "just_me", need: "quick_tracking" },
    { customers: "under_20", team: "just_me", need: "formal_process" },
  ] as const)("recommends CollectBoss when staff, scale or formal process is needed: %o", (answers) => {
    const result = recommendProduct(answers);
    expect(result.product).toBe("main");
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});
