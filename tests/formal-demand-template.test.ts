import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import test from "node:test";
import { buildFormalDemandText, FORMAL_DEMAND_DISCLAIMER, toDemandPdfData, type FormalDemandSnapshot } from "../src/lib/formal-demands/template.ts";
import { generateDemandPdf } from "../src/lib/pdf/demand-generator.ts";

function snapshot(creditorType: "individual" | "business", debtorType: "individual" | "business", partial = false): FormalDemandSnapshot {
  const value: FormalDemandSnapshot = {
    templateVersion: 1, documentNumber: "CB-FD-20260718-ABC12345", generatedAt: "2026-07-18T00:00:00.000Z", issuedAt: "2026-07-18T00:00:00.000Z",
    tone: "firm", deadlineDate: "1 August 2026", deadlineDays: 14,
    creditor: { accountType: creditorType, legalName: `Creditor ${"Long Name ".repeat(12)}`, contactName: "Owner", registrationNo: creditorType === "business" ? "202601012345" : null, phone: "0123456789", email: "owner@example.test", address: "1 Long Address, Kuala Lumpur" },
    debtor: { type: debtorType, name: `Debtor ${"Long Name ".repeat(12)}`, company: debtorType === "business" ? "Debtor Company Sdn Bhd" : null, registrationNo: debtorType === "business" ? "202601054321" : null, phone: null, email: null, address: "2 Long Address, Kuala Lumpur" },
    debtItems: [
      { reference: "Invoice No. INV-001", dueDate: "2026-06-01", originalAmount: 200, paidAmount: partial ? 50 : 0, outstandingAmount: partial ? 150 : 200 },
      { reference: "Invoice No. INV-002", dueDate: "2026-06-15", originalAmount: 100, paidAmount: 0, outstandingAmount: 100 },
    ],
    approvedPayments: partial ? [{ date: "2026-07-01T00:00:00.000Z", amount: 50, method: "bank_transfer", reference: "REF-1" }] : [],
    reminderCount: 2, paymentInstructionsIncluded: true,
    paymentInstructions: { bankName: "Example Bank", accountHolder: "Creditor", accountNumber: "123456789", duitnowId: null },
    evidenceReferenceIncluded: true, legalReviewRequired: false, legalReviewReason: null,
    disclaimer: "CollectBoss helps prepare document drafts based on your case records. This is not legal advice. Please consult a qualified lawyer before taking legal action.",
    pdf: { caseId: "case-1", businessName: "Creditor", tone: "firm", deadlineDays: 14, deadlineDate: "1 August 2026", today: "18 July 2026", draftText: "", documentNumber: "CB-FD-20260718-ABC12345", templateVersion: 1 },
  };
  value.pdf.draftText = buildFormalDemandText(value);
  return value;
}

test("all creditor/debtor identity combinations produce a demand with immutable identifiers", () => {
  for (const creditorType of ["individual", "business"] as const) {
    for (const debtorType of ["individual", "business"] as const) {
      const text = buildFormalDemandText(snapshot(creditorType, debtorType));
      assert.match(text, /Document No.: CB-FD-20260718-ABC12345/);
      assert.match(text, new RegExp(`Dear Debtor`));
      assert.match(text, /PAYMENT DETAILS:/);
      assert.match(text, /Invoice No. INV-002/);
      assert.match(text, /not legal advice/);
    }
  }
});

test("partial-payment demand preserves the remaining balance snapshot", () => {
  const text = buildFormalDemandText(snapshot("business", "business", true));
  assert.match(text, /partial payment of RM 50.00/);
  assert.match(text, /remaining balance of RM 150.00/);
  assert.equal(text.includes("RM 200.00"), false);
});

test("version 2 payment notices use factual labels while version 1 remains reproducible", () => {
  const legacy = snapshot("business", "business");
  assert.match(buildFormalDemandText(legacy), /FORMAL DEMAND NOTICE/);

  const current = snapshot("business", "business");
  current.templateVersion = 2;
  current.tone = "final";
  current.legalReviewRequired = true;
  current.legalReviewReason = "External review required before legal action.";
  current.disclaimer = FORMAL_DEMAND_DISCLAIMER;
  current.pdf.templateVersion = 2;
  current.pdf.tone = "final";
  const text = buildFormalDemandText(current);
  assert.match(text, /FINAL PAYMENT NOTICE/);
  assert.match(text, /may request external legal review/i);
  assert.match(text, /not a law firm/i);
  assert.doesNotMatch(text, /our legal advisors|recovery proceedings|FORMAL DEMAND NOTICE/i);
});

test("demand PDF renders from the persisted snapshot", async () => {
  const pdf = await generateDemandPdf(toDemandPdfData(snapshot("individual", "business", true)));
  const bytes = new Uint8Array(await pdf.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  if (process.env.RENDER_PDF_TEST === "true") {
    await mkdir("tmp/pdfs", { recursive: true });
    await writeFile("tmp/pdfs/formal-demand-render.pdf", bytes);
  }
});
