import type { LabelledMatchExample, PaymentMatchTarget } from "@/lib/payment-matching/engine";

const target = (input: Partial<PaymentMatchTarget> & Pick<PaymentMatchTarget, "key" | "customerId" | "customerName" | "caseId">): PaymentMatchTarget => ({
  customerPhone: null,
  accountId: null,
  accountReference: null,
  obligationId: null,
  invoiceNumber: null,
  issueDate: null,
  dueDate: null,
  outstandingMinor: 25_000,
  currency: "MYR",
  priorApprovedPaymentCount: 0,
  existingPayments: [],
  ...input,
});

export const labelledPaymentMatchingFixtures: LabelledMatchExample[] = [
  {
    id: "exact-invoice-reference",
    transaction: {
      id: "tx-1", amountMinor: 25_000, currency: "MYR", occurredAt: "2026-08-10T09:00:00+08:00",
      reference: "INV-1001", invoiceNumber: "INV-1001", partyName: "Acme Trading", accountReference: "AC-88",
      phone: null, phoneMatchPermitted: false,
    },
    targets: [
      target({ key: "wrong", customerId: "c-2", customerName: "Other Shop", caseId: "CB-2", invoiceNumber: "INV-2002", accountReference: "AC-99" }),
      target({ key: "right", customerId: "c-1", customerName: "Acme Trading", caseId: "CB-1", invoiceNumber: "INV-1001", accountReference: "AC-88", dueDate: "2026-08-09" }),
    ],
    expectedTargetKey: "right",
  },
  {
    id: "equal-amount-is-not-enough",
    transaction: {
      id: "tx-2", amountMinor: 25_000, currency: "MYR", occurredAt: null,
      reference: null, invoiceNumber: null, partyName: null, accountReference: null,
      phone: null, phoneMatchPermitted: false,
    },
    targets: [target({ key: "unknown", customerId: "c-3", customerName: "Unknown", caseId: "CB-3" })],
    expectedTargetKey: null,
  },
  {
    id: "currency-conflict",
    transaction: {
      id: "tx-3", amountMinor: 25_000, currency: "SGD", occurredAt: null,
      reference: "INV-1001", invoiceNumber: "INV-1001", partyName: "Acme Trading", accountReference: null,
      phone: null, phoneMatchPermitted: false,
    },
    targets: [target({ key: "myr", customerId: "c-1", customerName: "Acme Trading", caseId: "CB-1", invoiceNumber: "INV-1001" })],
    expectedTargetKey: null,
  },
  {
    id: "lawful-phone-and-partial-name",
    transaction: {
      id: "tx-4", amountMinor: 10_000, currency: "MYR", occurredAt: "2026-08-11T09:00:00+08:00",
      reference: null, invoiceNumber: null, partyName: "Siti Bakery", accountReference: null,
      phone: "+60 12-345 6789", phoneMatchPermitted: true,
    },
    targets: [target({ key: "siti", customerId: "c-4", customerName: "Siti Bakery Sdn Bhd", customerPhone: "60123456789", caseId: "CB-4", outstandingMinor: 30_000, dueDate: "2026-08-10", priorApprovedPaymentCount: 3 })],
    expectedTargetKey: "siti",
  },
];

