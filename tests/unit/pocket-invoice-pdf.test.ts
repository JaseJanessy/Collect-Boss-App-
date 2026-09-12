import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { extractNativePdfText } from "@/lib/document-intake/extraction/pdf";
import { generatePocketInvoicePdf } from "@/lib/pdf/pocket-invoice-generator";

describe("Pocket simple invoice PDF", () => {
  it("contains the approved invoice content and non-compliance disclaimer", async () => {
    const bytes = generatePocketInvoicePdf({
      invoiceNumber: "CBP-2026-000001", status: "issued", businessName: "Kedai Maju", businessContact: "hello@example.com",
      customerName: "Aisyah", customerContact: "+60123456789", issueDate: "2026-08-22", dueDate: "2026-08-29", currency: "MYR",
      items: [{ description: "Rice delivery", quantityMilli: 2_000, unitPriceMinor: 1_050, lineTotalMinor: 2_100 }],
      subtotalMinor: 2_100, discountMinor: 0, taxLabel: null, taxMinor: 0, totalMinor: 2_100,
      note: "Thank you", paymentInstructions: "Bank transfer only",
    });
    const extracted = await extractNativePdfText(bytes);
    const text = extracted.pages.map((page) => page.text).join(" ");
    for (const value of ["CBP-2026-000001", "Kedai Maju", "Aisyah", "Rice delivery", "MYR", "21.00", "NOT AN OFFICIAL E-INVOICE SERVICE"]) expect(text).toContain(value);
    expect(text).not.toMatch(/LHDN compliant|LHDN approved|government submission/iu);
  });

  it("repeats the table header and disclaimer on long multi-page invoices", async () => {
    const bytes = generatePocketInvoicePdf({
      invoiceNumber: "CBP-2026-000002", status: "issued", businessName: "Kedai Maju", businessContact: null,
      customerName: "Aisyah", customerContact: null, issueDate: "2026-08-22", dueDate: "2026-08-29", currency: "MYR",
      items: Array.from({ length: 30 }, (_, index) => ({ description: `Line item ${index + 1}`, quantityMilli: 1_000, unitPriceMinor: 100, lineTotalMinor: 100 })),
      subtotalMinor: 3_000, discountMinor: 0, taxLabel: null, taxMinor: 0, totalMinor: 3_000, note: null, paymentInstructions: null,
    });
    const extracted = await extractNativePdfText(bytes);
    expect(extracted.pageCount).toBeGreaterThan(1);
    for (const page of extracted.pages) expect(page.text).toContain("NOT AN OFFICIAL E-INVOICE SERVICE");
    expect(extracted.pages[1].text).toContain("DESCRIPTION");
  });
});
