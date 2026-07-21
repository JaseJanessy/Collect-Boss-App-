import assert from "node:assert/strict";
import test from "node:test";
import { buildSmallClaimPackText, SMALL_CLAIM_DISCLAIMER, type SmallClaimPackSnapshot } from "../src/lib/small-claims/template.ts";
import { generateSmallClaimPdf } from "../src/lib/pdf/small-claim-generator.ts";

function snapshot(): SmallClaimPackSnapshot {
  const checklist = Array.from({ length: 9 }, (_, index) => ({ id: `item-${index}`, label: `Record ${index}`, done: index < 4 }));
  return {
    templateVersion: 2,
    generatedAt: "2026-07-18T00:00:00.000Z",
    issuedAt: "2026-07-18T00:00:00.000Z",
    jurisdiction: { code: "MY", label: "Malaysia", filingRulesVerifiedAt: null },
    legalReviewRequired: true,
    checklist,
    missingItems: checklist.filter((item) => !item.done).map((item) => item.label),
    acknowledgement: { decision: "accepted", acknowledgedAt: "2026-07-17T00:00:00.000Z", termsVersion: 1 },
    pdf: {
      caseId: "CB-CASE-1", businessName: "Creditor Sdn Bhd", today: "18 July 2026", debtorName: "Debtor Name", debtorCompany: "Debtor Sdn Bhd", debtorRegNo: "202601012345", debtorPhone: "0123456789", debtorEmail: "debtor@example.test", debtorLocation: "Long address", amountOwed: 500, amountPaid: 100, balance: 400, dueDate: "2026-06-01", invoiceNo: "INV-1", daysOverdue: 47,
      checklist, readinessStatus: "almost_ready", readinessPct: 44, reminderCount: 12, paymentCount: 3, hasEvidencePack: true, hasFormalDemand: true, hasPaymentPlan: true, hasAcknowledgement: true,
      timeline: Array.from({ length: 70 }, (_, index) => ({ date: `2026-06-${String((index % 28) + 1).padStart(2, "0")}`, event: `Timeline event ${index}: ${"supporting detail ".repeat(10)}` })),
      evidenceFiles: Array.from({ length: 70 }, (_, index) => ({ name: `evidence-${index}-${"long-name-".repeat(6)}.pdf`, type: "PDF" })),
      missingItems: checklist.filter((item) => !item.done).map((item) => item.label), jurisdictionLabel: "Malaysia (filing rules require external verification)", disclaimer: SMALL_CLAIM_DISCLAIMER,
    },
  };
}

test("case-record text preserves jurisdiction and external legal-review gate", () => {
  const text = buildSmallClaimPackText(snapshot());
  assert.match(text, /Malaysia \(MY\)/);
  assert.match(text, /filing rules not verified/);
  assert.match(text, /not legal advice/);
  assert.doesNotMatch(text, /Form 198|Magistrate Court|RM 5,000/);
});

test("long case-record pack renders as a PDF", async () => {
  const pdf = await generateSmallClaimPdf(snapshot().pdf);
  const bytes = new Uint8Array(await pdf.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
});
