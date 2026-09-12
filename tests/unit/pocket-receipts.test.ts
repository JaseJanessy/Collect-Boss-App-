import { describe, expect, it } from "vitest";

import { pocketConfidenceLabel, pocketReceiptConfirmationSchema, pocketReceiptReviewSchema } from "@/lib/pocket/receipts";

describe("Pocket receipt review contracts", () => {
  it("uses plain-language confidence labels", () => {
    expect(pocketConfidenceLabel(0.95)).toBe("Looks clear");
    expect(pocketConfidenceLabel(0.7)).toBe("Please check");
    expect(pocketConfidenceLabel(0.2)).toBe("Could not read");
    expect(pocketConfidenceLabel(null)).toBe("Could not read");
  });

  it("accepts reviewed decimal strings without client-owned money or tenant scope", () => {
    const valid = { documentKind: "payment_receipt", amount: "12.30", paymentDate: "2026-08-21" };
    expect(pocketReceiptReviewSchema.safeParse(valid).success).toBe(true);
    expect(pocketReceiptReviewSchema.safeParse({ ...valid, amountMinor: 1230 }).success).toBe(false);
    expect(pocketReceiptReviewSchema.safeParse({ ...valid, businessId: crypto.randomUUID() }).success).toBe(false);
    expect(pocketReceiptReviewSchema.safeParse({ ...valid, currency: "MYR" }).success).toBe(false);
  });

  it("requires an authoritative debt snapshot for final confirmation", () => {
    const valid = { debtId: crypto.randomUUID(), expectedOutstandingMinor: 5000, method: "bank_transfer", duplicateAcknowledged: false };
    expect(pocketReceiptConfirmationSchema.safeParse(valid).success).toBe(true);
    expect(pocketReceiptConfirmationSchema.safeParse({ ...valid, expectedOutstandingMinor: 12.5 }).success).toBe(false);
    expect(pocketReceiptConfirmationSchema.safeParse({ ...valid, customerId: crypto.randomUUID() }).success).toBe(false);
  });
});
