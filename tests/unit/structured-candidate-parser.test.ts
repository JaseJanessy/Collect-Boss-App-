import { describe, expect, it } from "vitest";
import { buildStructuredExtraction } from "@/lib/document-intake/extraction/classifier";
import type { ExtractedPage } from "@/lib/document-intake/extraction/types";

function page(text: string): ExtractedPage {
  return {
    page: 1,
    imageId: null,
    text,
    lines: text.split("\n").map((line, index) => ({
      text: line,
      confidence: 0.96,
      boundingBox: { x: 10, y: index * 20, width: 500, height: 18 },
    })),
  };
}

describe("Prompt 12 structured candidate parser", () => {
  it("extracts party, identifier, invoice, dates and MYR amounts with provenance", () => {
    const result = buildStructuredExtraction([page([
      "INVOICE", "Company: Acme Trading Sdn. Bhd.", "SSM No: 202401234567",
      "Bill To: Kedai Maju", "Customer ID: CUST-0099", "Invoice No: INV-1007",
      "Invoice Date: 2026-08-01", "Due Date: 31/08/2026", "Tax: RM 60.00",
      "Total: RM 1,060.00", "Account Ref: ACC-778899",
    ].join("\n"))]);

    expect(result.field_candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ field_type: "company_name", normalized_value: "Acme Trading Sdn. Bhd" }),
      expect.objectContaining({ field_type: "invoice_number", normalized_value: "INV-1007" }),
      expect.objectContaining({ field_type: "due_date", normalized_value: "2026-08-31" }),
      expect.objectContaining({ field_type: "tax", normalized_value: { currency: "MYR", minor_units: 6000 } }),
      expect.objectContaining({ field_type: "document_total", normalized_value: { currency: "MYR", minor_units: 106000 } }),
    ]));
    for (const candidate of result.field_candidates) {
      expect(candidate.original_text).not.toBe("");
      expect(candidate.evidence.page).toBe(1);
      expect(candidate.evidence.textSpan).toBeDefined();
      expect(candidate.evidence.boundingBox).toBeDefined();
    }
  });

  it("normalizes international decimal separators and retains ambiguous alternatives", () => {
    const result = buildStructuredExtraction([page([
      "Invoice No: EU-22", "Invoice Date: 01/02/2026", "Due Date: 02/01/2026",
      "Tax: EUR 234,56", "Total: EUR 1.234,56",
    ].join("\n"))]);
    expect(result.field_candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ field_type: "tax", normalized_value: { currency: "EUR", minor_units: 23456 } }),
      expect.objectContaining({ field_type: "document_total", normalized_value: { currency: "EUR", minor_units: 123456 } }),
    ]));
    expect(result.field_candidates.filter((item) => item.field_type.endsWith("date")))
      .toHaveLength(2);
    expect(result.field_candidates.filter((item) => item.field_type.endsWith("date")))
      .toEqual(expect.arrayContaining([expect.objectContaining({ validation_flags: ["AMBIGUOUS_DATE"] })]));
  });

  it("flags impossible dates, duplicate invoice identifiers and unreconciled totals", () => {
    const result = buildStructuredExtraction([page([
      "Invoice No: DUP-42", "Invoice No: DUP-42", "Due Date: 31/02/2026",
      "Item service: RM 100.00", "Item hosting: RM 50.00", "Total: RM 175.00",
    ].join("\n"))]);
    expect(result.warnings).toEqual(expect.arrayContaining(["IMPOSSIBLE_DATE", "TOTAL_DOES_NOT_RECONCILE"]));
    expect(result.reconciliation).toMatchObject({ available: true, reconciles: false, line_item_minor_units: 15000, total_minor_units: 17500 });
    expect(result.field_candidates.filter((item) => item.field_type === "invoice_number"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ validation_flags: ["DUPLICATE_INVOICE_IDENTIFIER"] })]));
  });
});
