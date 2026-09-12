import { createHash } from "node:crypto";

export const discrepancyCodes = [
  "duplicate_invoice", "duplicate_transaction", "unapplied_credit_note", "stale_balance",
  "payment_proof_unmatched", "accounting_sync_difference", "contract_invoice_conflict", "debtor_paid_claim_conflict",
] as const;

export type DiscrepancyCode = typeof discrepancyCodes[number];
export type DiscrepancyState = "suspicious" | "inconsistent" | "incomplete" | "confirmed_error";
export type DiscrepancySeverity = "low" | "medium" | "high" | "critical";
export type DiscrepancyConfidence = "deterministic" | "high" | "medium" | "low";

export interface DiscrepancySourceRef {
  table: string;
  id: string;
  label: string;
  field?: string;
  value?: string;
  evidenceId?: string;
  locator?: string;
}

export interface InvoiceSnapshot {
  id: string;
  reference: string;
  amountMinor: bigint;
  currency: string;
  customerId: string;
  issueDate?: string | null;
  source: DiscrepancySourceRef;
}

export interface TransactionSnapshot {
  id: string;
  sourceSystem: string;
  sourceRecordId: string;
  amountMinor: bigint;
  currency: string;
  reference?: string | null;
  occurredAt?: string | null;
  fingerprint?: string | null;
  duplicateOfId?: string | null;
  existingPaymentId?: string | null;
  paymentSubmissionId?: string | null;
  source: DiscrepancySourceRef;
}

export interface CreditNoteSnapshot {
  id: string;
  amountMinor: bigint;
  appliedMinor: bigint;
  currency: string;
  source: DiscrepancySourceRef;
}

export interface AmountSnapshot {
  amountMinor: bigint;
  currency: string;
  version?: number;
  recordedAt?: string | null;
  source: DiscrepancySourceRef;
}

export interface PaymentProofSnapshot extends AmountSnapshot {
  id: string;
  matchedTransactionId?: string | null;
  status: string;
}

export interface AccountingSnapshot {
  id: string;
  entityType: string;
  externalAmountMinor: bigint;
  localAmountMinor: bigint;
  currency: string;
  externalSource: DiscrepancySourceRef;
  localSource: DiscrepancySourceRef;
}

export interface DocumentAmountSnapshot extends AmountSnapshot {
  id: string;
  kind: "contract" | "invoice";
  confidence: number;
}

export interface PaidClaimSnapshot extends AmountSnapshot {
  id: string;
  status: string;
  matchedPaymentId?: string | null;
}

export interface DiscrepancyInput {
  caseId: string;
  now: string;
  staleAfterDays?: number;
  invoices: readonly InvoiceSnapshot[];
  transactions: readonly TransactionSnapshot[];
  creditNotes: readonly CreditNoteSnapshot[];
  canonicalBalance: AmountSnapshot;
  storedBalance: AmountSnapshot;
  proofs: readonly PaymentProofSnapshot[];
  accounting: readonly AccountingSnapshot[];
  documents: readonly DocumentAmountSnapshot[];
  paidClaims: readonly PaidClaimSnapshot[];
}

export interface DetectedDiscrepancy {
  findingKey: string;
  code: DiscrepancyCode;
  state: DiscrepancyState;
  severity: DiscrepancySeverity;
  confidence: DiscrepancyConfidence;
  confidenceScore: number;
  impactedAmountMinor: bigint;
  currency: string;
  title: string;
  explanation: string;
  conflictingValues: Record<string, string>;
  sources: DiscrepancySourceRef[];
  recommendedAction: string;
  sourceFingerprint: string;
}

const dayMs = 86_400_000;
const normal = (value: string | null | undefined) => value?.trim().toLocaleUpperCase("en-US") ?? "";
const moneyDifference = (left: bigint, right: bigint) => left > right ? left - right : right - left;
const uniqueSources = (sources: readonly DiscrepancySourceRef[]) => [...new Map(sources.map((source) => [`${source.table}:${source.id}:${source.field ?? ""}`, source])).values()];

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item)).digest("hex");
}

function finding(input: Omit<DetectedDiscrepancy, "findingKey" | "sourceFingerprint"> & { stableParts: readonly string[] }): DetectedDiscrepancy {
  const sources = uniqueSources(input.sources).sort((a, b) => `${a.table}:${a.id}`.localeCompare(`${b.table}:${b.id}`));
  const findingKey = hash([input.code, ...input.stableParts].sort()).slice(0, 64);
  const sourceFingerprint = hash({
    code: input.code,
    conflictingValues: input.conflictingValues,
    sources: sources.map((source) => ({ ...source })),
  });
  const { stableParts: _stableParts, ...rest } = input;
  void _stableParts;
  return { ...rest, sources, findingKey, sourceFingerprint };
}

function severityFor(amount: bigint, state: DiscrepancyState): DiscrepancySeverity {
  if (state === "confirmed_error" && amount >= 1_000_000n) return "critical";
  if (amount >= 100_000n) return "high";
  if (amount > 0n) return "medium";
  return "low";
}

/** Deterministic identifier and arithmetic checks always run before similarity checks. */
export function detectDiscrepancies(input: DiscrepancyInput): DetectedDiscrepancy[] {
  const results: DetectedDiscrepancy[] = [];
  const invoicesByIdentifier = new Map<string, InvoiceSnapshot[]>();
  for (const invoice of input.invoices) {
    const key = `${invoice.customerId}:${normal(invoice.reference)}:${normal(invoice.currency)}`;
    if (normal(invoice.reference)) invoicesByIdentifier.set(key, [...(invoicesByIdentifier.get(key) ?? []), invoice]);
  }
  for (const [identifier, group] of [...invoicesByIdentifier].sort(([a], [b]) => a.localeCompare(b))) {
    if (group.length < 2) continue;
    const amounts = [...new Set(group.map((item) => item.amountMinor.toString()))];
    const impacted = group.reduce((total, item) => total + item.amountMinor, 0n) - group[0].amountMinor;
    results.push(finding({
      stableParts: group.map((item) => item.id), code: "duplicate_invoice", state: "suspicious",
      severity: severityFor(impacted, "suspicious"), confidence: "deterministic", confidenceScore: 100,
      impactedAmountMinor: impacted, currency: group[0].currency, title: "Duplicate invoice identifier",
      explanation: `${group.length} invoice records use the same customer-scoped identifier. This is a review candidate, not a conclusion that either record is invalid.`,
      conflictingValues: { identifier: identifier.split(":").slice(1, -1).join(":"), invoice_ids: group.map((item) => item.id).join(", "), amounts_minor: amounts.join(", ") },
      sources: group.map((item) => item.source), recommendedAction: "Compare the cited invoices and mark the duplicate through the authorised invoice workflow if confirmed.",
    }));
  }

  const exactTransactions = new Map<string, TransactionSnapshot[]>();
  for (const transaction of input.transactions) {
    const deterministicKey = transaction.duplicateOfId
      ? `linked:${[transaction.id, transaction.duplicateOfId].sort().join(":")}`
      : transaction.fingerprint ? `fingerprint:${transaction.fingerprint}`
        : `${transaction.sourceSystem}:${transaction.sourceRecordId}`;
    exactTransactions.set(deterministicKey, [...(exactTransactions.get(deterministicKey) ?? []), transaction]);
  }
  for (const [key, group] of [...exactTransactions].sort(([a], [b]) => a.localeCompare(b))) {
    if (group.length < 2 && !group[0]?.duplicateOfId) continue;
    const sources = group.map((item) => item.source);
    const amount = group.reduce((largest, item) => item.amountMinor > largest ? item.amountMinor : largest, 0n);
    results.push(finding({
      stableParts: group.flatMap((item) => [item.id, item.duplicateOfId ?? ""]), code: "duplicate_transaction", state: "suspicious",
      severity: severityFor(amount, "suspicious"), confidence: "deterministic", confidenceScore: 100,
      impactedAmountMinor: amount, currency: group[0].currency, title: "Duplicate transaction candidate",
      explanation: "The transactions share a deterministic source identity, fingerprint, or explicit duplicate link. Allocation remains a human decision.",
      conflictingValues: { duplicate_key: key, transaction_ids: group.map((item) => item.id).join(", "), amounts_minor: group.map((item) => item.amountMinor.toString()).join(", ") },
      sources, recommendedAction: "Review the original transaction records before approving or reversing any allocation.",
    }));
  }

  for (const credit of input.creditNotes.filter((item) => item.appliedMinor < item.amountMinor)) {
    const remaining = credit.amountMinor - credit.appliedMinor;
    results.push(finding({
      stableParts: [credit.id], code: "unapplied_credit_note", state: "incomplete", severity: severityFor(remaining, "incomplete"),
      confidence: "deterministic", confidenceScore: 100, impactedAmountMinor: remaining, currency: credit.currency,
      title: "Credit note is not fully applied", explanation: "The approved credit note exceeds the amount applied to this case balance.",
      conflictingValues: { credit_note_minor: credit.amountMinor.toString(), applied_minor: credit.appliedMinor.toString(), unapplied_minor: remaining.toString() },
      sources: [credit.source], recommendedAction: "Use the authorised credit-allocation workflow to apply, reverse, or explain the remaining credit.",
    }));
  }

  const balanceDifference = moneyDifference(input.canonicalBalance.amountMinor, input.storedBalance.amountMinor);
  const storedAt = input.storedBalance.recordedAt ? Date.parse(input.storedBalance.recordedAt) : Number.NaN;
  const canonicalAt = input.canonicalBalance.recordedAt ? Date.parse(input.canonicalBalance.recordedAt) : Number.NaN;
  const lagDays = Number.isFinite(storedAt) && Number.isFinite(canonicalAt)
    ? Math.max(0, Math.floor((canonicalAt - storedAt) / dayMs)) : null;
  const versionMismatch = input.canonicalBalance.version != null && input.storedBalance.version != null
    ? input.canonicalBalance.version !== input.storedBalance.version : false;
  const staleWithoutVersion = input.canonicalBalance.version == null && input.storedBalance.version == null
    && (lagDays === null || lagDays > (input.staleAfterDays ?? 2));
  if (balanceDifference > 0n || versionMismatch || staleWithoutVersion) {
    results.push(finding({
      stableParts: [input.caseId, "balance"], code: "stale_balance", state: balanceDifference > 0n ? "inconsistent" : "incomplete",
      severity: severityFor(balanceDifference, balanceDifference > 0n ? "inconsistent" : "incomplete"), confidence: "deterministic", confidenceScore: 100,
      impactedAmountMinor: balanceDifference, currency: input.canonicalBalance.currency, title: balanceDifference > 0n ? "Stored balance differs from the canonical ledger" : "Stored balance has not been refreshed",
      explanation: balanceDifference > 0n ? "The case projection and canonical ledger do not show the same outstanding amount." : versionMismatch ? "The case projection points to an older canonical ledger version." : "The stored balance projection trails the newest canonical ledger calculation by more than the review threshold.",
      conflictingValues: { canonical_minor: input.canonicalBalance.amountMinor.toString(), stored_minor: input.storedBalance.amountMinor.toString(), canonical_version: input.canonicalBalance.version == null ? "unknown" : String(input.canonicalBalance.version), projection_version: input.storedBalance.version == null ? "unknown" : String(input.storedBalance.version), projection_lag_days: lagDays === null ? "unknown" : String(lagDays) },
      sources: [input.canonicalBalance.source, input.storedBalance.source], recommendedAction: "Run the ledger reconciliation workflow and review its cited source events.",
    }));
  }

  for (const proof of input.proofs.filter((item) => !item.matchedTransactionId && !["rejected", "more_information_required"].includes(item.status))) {
    results.push(finding({
      stableParts: [proof.id], code: "payment_proof_unmatched", state: "incomplete", severity: severityFor(proof.amountMinor, "incomplete"),
      confidence: "deterministic", confidenceScore: 100, impactedAmountMinor: proof.amountMinor, currency: proof.currency,
      title: "Payment proof has no matching transaction", explanation: "A payment proof was submitted, but no normalized transaction is linked to it yet.",
      conflictingValues: { proof_status: proof.status, proof_amount_minor: proof.amountMinor.toString(), matched_transaction: "none" },
      sources: [proof.source], recommendedAction: "Review the proof and transaction queue; request more information if no bank or accounting record can be matched.",
    }));
  }

  for (const accounting of input.accounting.filter((item) => item.externalAmountMinor !== item.localAmountMinor)) {
    const difference = moneyDifference(accounting.externalAmountMinor, accounting.localAmountMinor);
    results.push(finding({
      stableParts: [accounting.id], code: "accounting_sync_difference", state: "inconsistent", severity: severityFor(difference, "inconsistent"),
      confidence: "deterministic", confidenceScore: 100, impactedAmountMinor: difference, currency: accounting.currency,
      title: "Accounting sync amount differs", explanation: "The last accounting-side value and CollectBoss value differ for the mapped record.",
      conflictingValues: { external_minor: accounting.externalAmountMinor.toString(), collectboss_minor: accounting.localAmountMinor.toString(), difference_minor: difference.toString() },
      sources: [accounting.externalSource, accounting.localSource], recommendedAction: "Preview a reconciliation sync and choose the authoritative source before applying a correction.",
    }));
  }

  const contracts = input.documents.filter((item) => item.kind === "contract");
  const invoiceDocuments = input.documents.filter((item) => item.kind === "invoice");
  for (const contract of contracts) for (const invoice of invoiceDocuments) {
    if (contract.currency !== invoice.currency || contract.amountMinor === invoice.amountMinor) continue;
    const score = Math.round(Math.min(contract.confidence, invoice.confidence) * 100);
    if (score < 70) continue;
    const difference = moneyDifference(contract.amountMinor, invoice.amountMinor);
    results.push(finding({
      stableParts: [contract.id, invoice.id], code: "contract_invoice_conflict", state: "suspicious", severity: severityFor(difference, "suspicious"),
      confidence: score >= 90 ? "high" : "medium", confidenceScore: score, impactedAmountMinor: difference, currency: contract.currency,
      title: "Contract and invoice amounts differ", explanation: "Human-confirmed document amounts differ. Document similarity supports review but does not establish which value is correct.",
      conflictingValues: { contract_minor: contract.amountMinor.toString(), invoice_minor: invoice.amountMinor.toString(), difference_minor: difference.toString() },
      sources: [contract.source, invoice.source], recommendedAction: "Compare the cited contract and invoice locations, then confirm the correct amount through the financial adjustment workflow.",
    }));
  }

  for (const claim of input.paidClaims.filter((item) => !item.matchedPaymentId && ["submitted", "under_review", "information_requested", "partially_accepted"].includes(item.status))) {
    results.push(finding({
      stableParts: [claim.id], code: "debtor_paid_claim_conflict", state: "inconsistent", severity: severityFor(claim.amountMinor, "inconsistent"),
      confidence: "deterministic", confidenceScore: 100, impactedAmountMinor: claim.amountMinor, currency: claim.currency,
      title: "Paid claim conflicts with the payment ledger", explanation: "The debtor reports payment, while the canonical ledger has no cited matching payment for this claim.",
      conflictingValues: { claimed_paid_minor: claim.amountMinor.toString(), matched_payment: "none", claim_status: claim.status },
      sources: [claim.source], recommendedAction: "Review the debtor's evidence and payment matching queue. Do not contact or escalate automatically.",
    }));
  }

  return results.sort((a, b) => a.code.localeCompare(b.code) || a.findingKey.localeCompare(b.findingKey));
}
