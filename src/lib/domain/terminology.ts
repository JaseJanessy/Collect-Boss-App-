export const PRODUCT_TERMS = {
  debtor: {
    label: "Debtor",
    definition: "The person or organisation that owes an amount being recovered.",
    audienceLabels: { relationship: "Customer" },
  },
  customer: {
    label: "Customer",
    definition: "The creditor's commercial relationship record; use Debtor in recovery and legal contexts.",
  },
  case: {
    label: "Case",
    definition: "A controlled recovery workflow for one debtor and its selected receivables.",
  },
  receivable: {
    label: "Receivable",
    definition: "An amount owed to the creditor, whether invoiced or arising from another obligation.",
  },
  invoice: {
    label: "Invoice",
    definition: "A billed receivable identified by an invoice reference; not every receivable is an invoice.",
  },
  paymentProof: {
    label: "Payment Proof",
    definition: "Evidence submitted to support a claimed payment; it is not a confirmed payment or receipt.",
  },
  receipt: {
    label: "Receipt",
    definition: "A record issued after a payment has been confirmed and applied.",
  },
  promiseToPay: {
    label: "Promise to Pay",
    definition: "A debtor commitment to pay a stated amount by a stated date.",
  },
  paymentPlan: {
    label: "Payment Plan",
    definition: "An agreed schedule of multiple instalments; it is distinct from a single Promise to Pay.",
  },
  dispute: {
    label: "Dispute",
    definition: "A recorded challenge to all or part of a receivable, with its own review and resolution history.",
  },
  settlement: {
    label: "Settlement",
    definition: "An approved resolution combining any cash received with a separately recorded balance adjustment.",
  },
  closure: {
    label: "Case Closure",
    definition: "The controlled end of recovery work with a recorded closure reason; closure does not erase history.",
  },
  formalDemand: {
    label: "Formal Demand",
    definition: "A formal payment demand produced from the case record; it is not legal advice or a court filing.",
  },
  legalHandoff: {
    label: "Legal Handoff",
    definition: "A controlled transfer of case information to an authorised legal professional for independent review.",
  },
} as const;

export type ProductTerm = keyof typeof PRODUCT_TERMS;

export const ACTION_LABELS = {
  cancel: "Cancel",
  save: "Save",
  approve: "Approve",
  reject: "Reject",
  escalate: "Escalate",
  closeCase: "Close Case",
  archive: "Archive",
  recordPayment: "Record Payment",
  recordSettlement: "Record Settlement",
  addPromiseToPay: "Add Promise to Pay",
} as const;
