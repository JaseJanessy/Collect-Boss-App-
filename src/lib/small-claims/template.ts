import type { SmallClaimCheckItem, SmallClaimPdfData } from "../pdf/small-claim-generator";

export const SMALL_CLAIM_TEMPLATE_VERSION = 2;
export const SMALL_CLAIM_DISCLAIMER =
  "This document is a factual case-record pack prepared from CollectBoss data. It is not legal advice, does not determine court eligibility, and does not submit a claim. Obtain qualified legal review and verify current filing requirements with the relevant official authority before taking action.";

export interface SmallClaimPackSnapshot {
  templateVersion: number;
  generatedAt: string;
  issuedAt: string;
  jurisdiction: { code: "MY"; label: "Malaysia"; filingRulesVerifiedAt: null };
  legalReviewRequired: true;
  checklist: SmallClaimCheckItem[];
  missingItems: string[];
  acknowledgement: { decision: "accepted" | "rejected"; acknowledgedAt: string; termsVersion: number } | null;
  pdf: SmallClaimPdfData;
}

export function buildSmallClaimPackText(snapshot: SmallClaimPackSnapshot): string {
  const debtReference = snapshot.pdf.invoiceNo
    ? `Invoice reference: ${snapshot.pdf.invoiceNo}`
    : `Case reference: ${snapshot.pdf.caseId}`;
  const missing = snapshot.missingItems.length ? snapshot.missingItems.map((item) => `- ${item}`).join("\n") : "None recorded";
  return [
    "CASE-RECORD PACK FOR LEGAL REVIEW",
    `Generated: ${snapshot.generatedAt}`,
    `Jurisdiction configuration: ${snapshot.jurisdiction.label} (${snapshot.jurisdiction.code}); filing rules not verified by CollectBoss.`,
    debtReference,
    `Outstanding balance: RM ${snapshot.pdf.balance.toFixed(2)}`,
    `Due date: ${snapshot.pdf.dueDate}`,
    "",
    "Missing information:",
    missing,
    "",
    SMALL_CLAIM_DISCLAIMER,
  ].join("\n");
}
