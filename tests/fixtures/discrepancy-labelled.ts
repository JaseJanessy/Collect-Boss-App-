import type { DiscrepancyInput, DiscrepancySourceRef } from "@/lib/discrepancies/engine";

const source = (table: string, id: string, label = id): DiscrepancySourceRef => ({ table, id, label });

export function cleanDiscrepancyFixture(contractConfidence = 0.69): DiscrepancyInput {
  return {
    caseId: "CB-TEST-1", now: "2026-08-12T00:00:00.000Z", staleAfterDays: 2,
    invoices: [
      { id: "invoice-1", reference: "INV-001", amountMinor: 10_000n, currency: "MYR", customerId: "customer-1", source: source("obligations", "invoice-1") },
      { id: "invoice-2", reference: "INV-002", amountMinor: 12_000n, currency: "MYR", customerId: "customer-1", source: source("obligations", "invoice-2") },
    ],
    transactions: [
      { id: "transaction-1", sourceSystem: "bank-a", sourceRecordId: "A-1", fingerprint: "fingerprint-a", amountMinor: 5_000n, currency: "MYR", source: source("normalized_payment_transactions", "transaction-1") },
      { id: "transaction-2", sourceSystem: "bank-a", sourceRecordId: "A-2", fingerprint: "fingerprint-b", amountMinor: 5_000n, currency: "MYR", source: source("normalized_payment_transactions", "transaction-2") },
    ],
    creditNotes: [{ id: "credit-1", amountMinor: 1_000n, appliedMinor: 1_000n, currency: "MYR", source: source("financial_adjustments", "credit-1") }],
    canonicalBalance: { amountMinor: 17_000n, currency: "MYR", recordedAt: "2026-08-12T00:00:00.000Z", source: source("debt_balance_versions", "balance-1") },
    storedBalance: { amountMinor: 17_000n, currency: "MYR", recordedAt: "2026-08-12T00:00:00.000Z", source: source("cases", "CB-TEST-1") },
    proofs: [{ id: "proof-1", amountMinor: 5_000n, currency: "MYR", status: "submitted", matchedTransactionId: "transaction-1", source: source("public_payment_submissions", "proof-1") }],
    accounting: [{ id: "mapping-1", entityType: "invoice", externalAmountMinor: 10_000n, localAmountMinor: 10_000n, currency: "MYR", externalSource: source("accounting_external_mappings", "mapping-1"), localSource: source("obligations", "invoice-1") }],
    documents: [
      { id: "contract-1", kind: "contract", amountMinor: 10_000n, currency: "MYR", confidence: contractConfidence, source: source("document_intake_confirmations", "contract-1") },
      { id: "invoice-document-1", kind: "invoice", amountMinor: 12_000n, currency: "MYR", confidence: 0.99, source: source("document_intake_confirmations", "invoice-document-1") },
    ],
    paidClaims: [{ id: "claim-1", amountMinor: 5_000n, currency: "MYR", status: "under_review", matchedPaymentId: "payment-1", source: source("disputes", "claim-1") }],
  };
}

export function positiveDiscrepancyFixture(): DiscrepancyInput {
  const fixture = cleanDiscrepancyFixture(0.92);
  return {
    ...fixture,
    invoices: [...fixture.invoices, { id: "invoice-duplicate", reference: " inv-001 ", amountMinor: 10_000n, currency: "MYR", customerId: "customer-1", source: source("obligations", "invoice-duplicate") }],
    transactions: [...fixture.transactions, { id: "transaction-duplicate", sourceSystem: "bank-a", sourceRecordId: "A-3", fingerprint: "fingerprint-a", amountMinor: 5_000n, currency: "MYR", source: source("normalized_payment_transactions", "transaction-duplicate") }],
    creditNotes: [{ id: "credit-1", amountMinor: 1_000n, appliedMinor: 250n, currency: "MYR", source: source("financial_adjustments", "credit-1") }],
    storedBalance: { ...fixture.storedBalance, amountMinor: 18_000n },
    proofs: [{ ...fixture.proofs[0], matchedTransactionId: null }],
    accounting: [{ ...fixture.accounting[0], externalAmountMinor: 11_500n }],
    paidClaims: [{ ...fixture.paidClaims[0], matchedPaymentId: null }],
  };
}

