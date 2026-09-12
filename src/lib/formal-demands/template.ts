import type { DemandPdfData } from "@/lib/pdf/demand-generator";

export const FORMAL_DEMAND_TEMPLATE_VERSION = 2;
export const FORMAL_DEMAND_DISCLAIMER = "CollectBoss prepares a factual payment-notice draft from the creditor's case records. CollectBoss is not a law firm, does not provide legal advice, and does not issue this document with lawyer or court authority. Obtain qualified legal review before relying on escalation language or taking legal action.";

export type FormalDemandTone = "standard" | "firm" | "final";

export interface FormalDemandSnapshot {
  templateVersion: number;
  documentNumber: string | null;
  generatedAt: string;
  issuedAt: string | null;
  tone: FormalDemandTone;
  deadlineDate: string;
  deadlineDays: number;
  creditor: { accountType: "individual" | "business"; legalName: string; contactName: string; registrationNo: string | null; phone: string; email: string; address: string | null };
  debtor: { type: "individual" | "business"; name: string; company: string | null; registrationNo: string | null; phone: string | null; email: string | null; address: string | null };
  debtItems: Array<{ reference: string; dueDate: string; originalAmount: number; paidAmount: number; outstandingAmount: number }>;
  approvedPayments: Array<{ date: string; amount: number; method: string; reference: string | null }>;
  reminderCount: number;
  paymentInstructionsIncluded: boolean;
  paymentInstructions: { bankName: string; accountHolder: string; accountNumber: string; duitnowId: string | null } | null;
  evidenceReferenceIncluded: boolean;
  legalReviewRequired: boolean;
  legalReviewReason: string | null;
  disclaimer: string;
  pdf: DemandPdfData;
}

function formatMoney(amount: number): string {
  return `RM ${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

function recipient(snapshot: FormalDemandSnapshot): string {
  return snapshot.debtor.company && snapshot.debtor.company !== snapshot.debtor.name
    ? `${snapshot.debtor.company}\nAttn: ${snapshot.debtor.name}`
    : snapshot.debtor.name;
}

export function buildFormalDemandText(snapshot: FormalDemandSnapshot): string {
  const debt = snapshot.debtItems[0];
  const amount = formatMoney(debt.outstandingAmount);
  const payment = debt.paidAmount > 0
    ? `\nWe acknowledge receipt of a partial payment of ${formatMoney(debt.paidAmount)}. The remaining balance of ${amount} is still outstanding.`
    : "";
  const reminders = snapshot.reminderCount > 0
    ? `We have previously sent ${snapshot.reminderCount} payment reminder${snapshot.reminderCount === 1 ? "" : "s"} without receiving a satisfactory response.\n`
    : "";
  const subject = `RE: Outstanding Payment - ${debt.reference} - ${amount}`;
  const itemSummary = snapshot.debtItems.length > 1
    ? `\nDebt Items:\n${snapshot.debtItems.map((item) => `- ${item.reference}: ${formatMoney(item.outstandingAmount)} (due ${item.dueDate})`).join("\n")}\n`
    : "";
  const paymentDetails = snapshot.paymentInstructionsIncluded && snapshot.paymentInstructions
    ? `\nPAYMENT DETAILS:\nBank: ${snapshot.paymentInstructions.bankName}\nAccount Holder: ${snapshot.paymentInstructions.accountHolder}\nAccount No.: ${snapshot.paymentInstructions.accountNumber}${snapshot.paymentInstructions.duitnowId ? `\nDuitNow ID: ${snapshot.paymentInstructions.duitnowId}` : ""}\nReference: ${snapshot.pdf.caseId}\n`
    : "";
  const evidenceReference = snapshot.evidenceReferenceIncluded
    ? "\nWe maintain records supporting this matter, including relevant invoices, delivery records, and prior communications.\n"
    : "";
  const legacyTemplate = snapshot.templateVersion < 2;
  const finalLine = legacyTemplate
    ? snapshot.tone === "final"
      ? "If payment is not received by the deadline, we may refer the matter for legal review and recovery options."
      : snapshot.tone === "firm"
        ? "Failure to settle this amount within the stated period may require further recovery action."
        : "We hope to resolve this matter amicably and ask that you contact us promptly if you need to discuss payment arrangements."
    : snapshot.tone === "final"
      ? "If payment is not received by the deadline, the creditor may request external legal review before deciding whether any further action is appropriate."
      : snapshot.tone === "firm"
        ? "If the amount remains unpaid, the creditor may continue factual payment follow-up or request external legal review."
        : "We hope to resolve this matter amicably and ask that you contact us promptly if you need to discuss payment arrangements.";
  const heading = legacyTemplate
    ? snapshot.tone === "final" ? "FINAL NOTICE OF OUTSTANDING PAYMENT" : snapshot.tone === "firm" ? "FORMAL DEMAND NOTICE" : "NOTICE OF OUTSTANDING PAYMENT"
    : snapshot.tone === "final" ? "FINAL PAYMENT NOTICE" : snapshot.tone === "firm" ? "FIRM PAYMENT REMINDER" : "FORMAL PAYMENT REMINDER";

  return `${heading}\n\nDate: ${snapshot.pdf.today}\nDocument No.: ${snapshot.documentNumber ?? "Draft"}\nCase Reference: ${snapshot.pdf.caseId}\n\nTo:\n${recipient(snapshot)}\n\n${subject}\n\nDear ${snapshot.debtor.name},\n\nThis notice concerns ${debt.reference}, which was due on ${debt.dueDate}. The outstanding balance is ${amount}.${payment}${itemSummary}\n${reminders}\nPlease arrange payment of the full outstanding amount within ${snapshot.deadlineDays} days, by ${snapshot.deadlineDate}.\n\n${finalLine}${paymentDetails}${evidenceReference}\nYours faithfully,\n\n${snapshot.creditor.legalName}\n\n---\n${snapshot.disclaimer}`;
}

export function toDemandPdfData(snapshot: FormalDemandSnapshot): DemandPdfData {
  return { ...snapshot.pdf, draftText: buildFormalDemandText(snapshot) };
}
