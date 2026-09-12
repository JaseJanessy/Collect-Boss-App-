import { describe, expect, it } from "vitest";

import {
  calculatePocketInvoice,
  formatInvoiceQuantity,
  invoiceWhatsAppMessage,
  pocketInvoiceDisplayStatus,
  pocketInvoiceDraftInputSchema,
} from "@/lib/pocket/invoices";

const input = {
  customerId: "11111111-1111-4111-8111-111111111111",
  issueDate: "2026-08-22", dueDate: "2026-08-29", businessName: "Kedai Maju", businessContact: null,
  customerName: "Aisyah", customerContact: null, discount: "5.00", taxLabel: "SST", tax: "3.00",
  note: null, paymentInstructions: "Bank transfer", items: [
    { description: "Rice", quantity: "2", unitPrice: "10.00" },
    { description: "Delivery", quantity: "0.5", unitPrice: "6.00" },
  ],
};

describe("Pocket invoice money and state rules", () => {
  it("uses integer minor units and deterministic three-decimal quantities", () => {
    const parsed = pocketInvoiceDraftInputSchema.parse(input);
    expect(calculatePocketInvoice(parsed, "MYR")).toEqual({
      items: [
        { position: 1, description: "Rice", quantityMilli: 2_000, unitPriceMinor: 1_000, lineTotalMinor: 2_000 },
        { position: 2, description: "Delivery", quantityMilli: 500, unitPriceMinor: 600, lineTotalMinor: 300 },
      ],
      subtotalMinor: 2_300, discountMinor: 500, taxMinor: 300, totalMinor: 2_100,
    });
    expect(formatInvoiceQuantity(12_340)).toBe("12.34");
  });

  it("rejects over-precision, invalid date order, unsafe tax pairing and excessive discount", () => {
    expect(pocketInvoiceDraftInputSchema.safeParse({ ...input, items: [{ ...input.items[0], quantity: "1.0001" }] }).success).toBe(false);
    expect(pocketInvoiceDraftInputSchema.safeParse({ ...input, dueDate: "2026-08-21" }).success).toBe(false);
    expect(pocketInvoiceDraftInputSchema.safeParse({ ...input, taxLabel: null, tax: "3.00" }).success).toBe(false);
    expect(() => calculatePocketInvoice(pocketInvoiceDraftInputSchema.parse({ ...input, discount: "999.00" }), "MYR")).toThrow(/Discount/);
  });

  it("derives payment status only from the linked ledger projection", () => {
    expect(pocketInvoiceDisplayStatus("issued", 0, 2_100)).toBe("issued");
    expect(pocketInvoiceDisplayStatus("issued", 500, 1_600)).toBe("partially_paid");
    expect(pocketInvoiceDisplayStatus("partially_paid", 2_100, 0)).toBe("paid");
    expect(pocketInvoiceDisplayStatus("cancelled", null, null)).toBe("cancelled");
  });

  it("creates a neutral user-confirmed WhatsApp handoff message", () => {
    const text = invoiceWhatsAppMessage("CBP-2026-000001", "MYR 21.00", "Kedai Maju");
    expect(text).toContain("CBP-2026-000001");
    expect(text).toContain("after you confirm");
    expect(text).not.toMatch(/\bsent\b|\bdelivered\b|\bread\b/iu);
  });
});
