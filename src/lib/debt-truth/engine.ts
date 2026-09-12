import { createHash } from "node:crypto";
import { normalizeCurrencyCode, type MinorUnits } from "@/lib/financial/money";

export const debtLedgerEventKinds = [
  "original_principal", "invoice", "adjustment_debit", "adjustment_credit",
  "fee", "interest", "credit_note", "payment", "write_off",
] as const;

export type DebtLedgerEventKind = typeof debtLedgerEventKinds[number];
export type DebtLedgerApprovalStatus = "approved" | "pending" | "rejected" | "reversed";

export interface DebtEvidenceCitation {
  evidenceId: string;
  label: string;
  locator?: string | null;
  factVersion?: number | null;
}

export interface DebtLedgerEventInput {
  id: string;
  kind: DebtLedgerEventKind;
  amountMinor: MinorUnits;
  currency: string;
  approvalStatus: DebtLedgerApprovalStatus;
  sourceTable: string;
  sourceId: string;
  sourceVersion?: number;
  citations?: readonly DebtEvidenceCitation[];
  reversesEventId?: string | null;
}

export interface DebtDisputeInput {
  id: string;
  amountMinor: MinorUnits;
  currency: string;
  status: "submitted" | "under_review" | "information_requested" | "partially_accepted" | "accepted" | "rejected" | "resolved" | "withdrawn";
  resolutionAmountMinor?: MinorUnits | null;
  citations?: readonly DebtEvidenceCitation[];
}

export interface DebtExplanationNode {
  key: string;
  label: string;
  amountMinor: string;
  operation: "base" | "add" | "subtract" | "classify" | "total" | "information";
  authoritative: boolean;
  eventIds: string[];
  citations: DebtEvidenceCitation[];
  children?: DebtExplanationNode[];
}

export interface DebtTruthBalance {
  currency: string;
  originalPrincipalMinor: MinorUnits;
  invoicedAmountMinor: MinorUnits;
  approvedAdjustmentsMinor: MinorUnits;
  approvedFeesMinor: MinorUnits;
  creditNotesMinor: MinorUnits;
  confirmedPaymentsMinor: MinorUnits;
  disputedAmountMinor: MinorUnits;
  unverifiedAmountMinor: MinorUnits;
  unverifiedCreditMinor: MinorUnits;
  confirmedOutstandingMinor: MinorUnits;
  totalDisplayedExposureMinor: MinorUnits;
  overpaymentMinor: MinorUnits;
  sourceFingerprint: string;
  explanation: DebtExplanationNode;
  userExplanation: string;
}

const activeDisputeStatuses = new Set<DebtDisputeInput["status"]>([
  "submitted", "under_review", "information_requested", "partially_accepted",
]);

function sum(events: readonly DebtLedgerEventInput[], kinds: readonly DebtLedgerEventKind[]) {
  const allowed = new Set<DebtLedgerEventKind>(kinds);
  return events.reduce((total, event) => allowed.has(event.kind) ? total + event.amountMinor : total, 0n);
}

function citationsFor(events: readonly DebtLedgerEventInput[]) {
  return events.flatMap((event) => [...(event.citations ?? [])]);
}

function node(
  key: string,
  label: string,
  amount: bigint,
  operation: DebtExplanationNode["operation"],
  authoritative: boolean,
  events: readonly DebtLedgerEventInput[] = [],
): DebtExplanationNode {
  return {
    key,
    label,
    amountMinor: amount.toString(),
    operation,
    authoritative,
    eventIds: events.map((event) => event.id),
    citations: citationsFor(events),
  };
}

function fingerprint(
  currency: string,
  events: readonly DebtLedgerEventInput[],
  disputes: readonly DebtDisputeInput[],
) {
  const canonical = {
    currency,
    events: [...events].sort((a, b) => a.id.localeCompare(b.id)).map((event) => ({
      id: event.id,
      kind: event.kind,
      amountMinor: event.amountMinor.toString(),
      approvalStatus: event.approvalStatus,
      sourceTable: event.sourceTable,
      sourceId: event.sourceId,
      sourceVersion: event.sourceVersion ?? 1,
      reversesEventId: event.reversesEventId ?? null,
      citations: [...(event.citations ?? [])].sort((a, b) =>
        `${a.evidenceId}:${a.locator ?? ""}`.localeCompare(`${b.evidenceId}:${b.locator ?? ""}`)),
    })),
    disputes: [...disputes].sort((a, b) => a.id.localeCompare(b.id)).map((dispute) => ({
      id: dispute.id,
      amountMinor: dispute.amountMinor.toString(),
      status: dispute.status,
      resolutionAmountMinor: dispute.resolutionAmountMinor?.toString() ?? null,
      citations: [...(dispute.citations ?? [])].sort((a, b) =>
        `${a.evidenceId}:${a.locator ?? ""}`.localeCompare(`${b.evidenceId}:${b.locator ?? ""}`)),
    })),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/**
 * Deterministic authoritative calculation. Generative systems must never call
 * this with invented events; callers must load persisted, approval-gated facts.
 */
export function calculateDebtTruth(
  currencyInput: string,
  inputEvents: readonly DebtLedgerEventInput[],
  disputes: readonly DebtDisputeInput[] = [],
): DebtTruthBalance {
  const currency = normalizeCurrencyCode(currencyInput);
  const inputEventsOrdered = [...inputEvents].sort((a, b) => a.id.localeCompare(b.id));
  const disputesOrdered = [...disputes].sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Set<string>();
  for (const event of inputEventsOrdered) {
    if (!event.id || ids.has(event.id)) throw new Error("Ledger event IDs must be unique.");
    ids.add(event.id);
    if (event.amountMinor <= 0n) throw new Error("Ledger event amounts must be positive integer minor units.");
    if (normalizeCurrencyCode(event.currency) !== currency) throw new Error("A debt balance cannot mix currencies.");
  }
  for (const dispute of disputesOrdered) {
    if (dispute.amountMinor <= 0n) throw new Error("Disputed amounts must be positive integer minor units.");
    if (normalizeCurrencyCode(dispute.currency) !== currency) throw new Error("A debt balance cannot mix currencies.");
    if (dispute.resolutionAmountMinor != null && (dispute.resolutionAmountMinor < 0n || dispute.resolutionAmountMinor > dispute.amountMinor)) {
      throw new Error("A dispute resolution amount must be between zero and the disputed amount.");
    }
  }

  const reversedIds = new Set(inputEventsOrdered.filter((event) => event.approvalStatus === "reversed").map((event) => event.id));
  for (const event of inputEventsOrdered) if (event.reversesEventId) reversedIds.add(event.reversesEventId);
  const approved = inputEventsOrdered.filter((event) =>
    event.approvalStatus === "approved" && !event.reversesEventId && !reversedIds.has(event.id));
  const unverified = inputEventsOrdered.filter((event) =>
    event.approvalStatus === "pending" && !event.reversesEventId && !reversedIds.has(event.id));

  const originals = approved.filter((event) => event.kind === "original_principal");
  const invoices = approved.filter((event) => event.kind === "invoice");
  const adjustmentDebits = approved.filter((event) => event.kind === "adjustment_debit");
  const adjustmentCredits = approved.filter((event) => event.kind === "adjustment_credit" || event.kind === "write_off");
  const fees = approved.filter((event) => event.kind === "fee" || event.kind === "interest");
  const creditNotes = approved.filter((event) => event.kind === "credit_note");
  const payments = approved.filter((event) => event.kind === "payment");

  const originalPrincipalMinor = sum(originals, ["original_principal"]);
  const invoicedAmountMinor = sum(invoices, ["invoice"]);
  const chargeBaseMinor = invoices.length > 0 ? invoicedAmountMinor : originalPrincipalMinor;
  const approvedAdjustmentsMinor = sum(adjustmentDebits, ["adjustment_debit"]) -
    sum(adjustmentCredits, ["adjustment_credit", "write_off"]);
  const approvedFeesMinor = sum(fees, ["fee", "interest"]);
  const creditNotesMinor = sum(creditNotes, ["credit_note"]);
  const confirmedPaymentsMinor = sum(payments, ["payment"]);
  const contractualMinor = chargeBaseMinor + approvedAdjustmentsMinor + approvedFeesMinor - creditNotesMinor;
  if (contractualMinor < 0n) throw new Error("Approved credits cannot reduce contractual debt below zero.");

  const remainingBeforeClassification = contractualMinor > confirmedPaymentsMinor
    ? contractualMinor - confirmedPaymentsMinor
    : 0n;
  const overpaymentMinor = confirmedPaymentsMinor > contractualMinor ? confirmedPaymentsMinor - contractualMinor : 0n;
  const activeDisputes = disputesOrdered.filter((dispute) => activeDisputeStatuses.has(dispute.status));
  const requestedDisputeMinor = activeDisputes.reduce((total, dispute) => {
    const remaining = dispute.status === "partially_accepted"
      ? dispute.amountMinor - (dispute.resolutionAmountMinor ?? 0n)
      : dispute.amountMinor;
    return total + remaining;
  }, 0n);
  const disputedAmountMinor = requestedDisputeMinor > remainingBeforeClassification
    ? remainingBeforeClassification
    : requestedDisputeMinor;
  const confirmedOutstandingMinor = remainingBeforeClassification - disputedAmountMinor;

  const unverifiedCharges = unverified.filter((event) => ["original_principal", "invoice", "adjustment_debit", "fee", "interest"].includes(event.kind));
  const unverifiedCredits = unverified.filter((event) => ["adjustment_credit", "credit_note", "payment", "write_off"].includes(event.kind));
  const unverifiedAmountMinor = unverifiedCharges.reduce((total, event) => total + event.amountMinor, 0n);
  const unverifiedCreditMinor = unverifiedCredits.reduce((total, event) => total + event.amountMinor, 0n);
  const totalDisplayedExposureMinor = confirmedOutstandingMinor + disputedAmountMinor + unverifiedAmountMinor;

  const disputeNode: DebtExplanationNode = {
    key: "disputed_amount",
    label: "Open disputed amount",
    amountMinor: disputedAmountMinor.toString(),
    operation: "classify",
    authoritative: false,
    eventIds: activeDisputes.map((dispute) => dispute.id),
    citations: activeDisputes.flatMap((dispute) => [...(dispute.citations ?? [])]),
  };
  const explanation: DebtExplanationNode = {
    key: "total_displayed_exposure",
    label: "Total displayed exposure",
    amountMinor: totalDisplayedExposureMinor.toString(),
    operation: "total",
    authoritative: false,
    eventIds: [],
    citations: [],
    children: [
      {
        key: "confirmed_outstanding_balance",
        label: "Confirmed outstanding balance",
        amountMinor: confirmedOutstandingMinor.toString(),
        operation: "total",
        authoritative: true,
        eventIds: approved.map((event) => event.id),
        citations: citationsFor(approved),
        children: [
          node("original_principal", "Original principal", originalPrincipalMinor, "information", true, originals),
          node("invoiced_amount", "Approved invoiced amount", invoicedAmountMinor, invoices.length ? "base" : "information", true, invoices),
          node("approved_adjustments", "Net approved adjustments", approvedAdjustmentsMinor, approvedAdjustmentsMinor < 0n ? "subtract" : "add", true, [...adjustmentDebits, ...adjustmentCredits]),
          node("approved_fees", "Approved fees and interest", approvedFeesMinor, "add", true, fees),
          node("credit_notes", "Approved credit notes", creditNotesMinor, "subtract", true, creditNotes),
          node("confirmed_payments", "Confirmed payments", confirmedPaymentsMinor, "subtract", true, payments),
          disputeNode,
        ],
      },
      disputeNode,
      node("unverified_amount", "Unverified potential charges", unverifiedAmountMinor, "add", false, unverifiedCharges),
      node("unverified_credit", "Unverified credits or payment claims (not deducted)", unverifiedCreditMinor, "information", false, unverifiedCredits),
    ],
  };

  return {
    currency,
    originalPrincipalMinor,
    invoicedAmountMinor,
    approvedAdjustmentsMinor,
    approvedFeesMinor,
    creditNotesMinor,
    confirmedPaymentsMinor,
    disputedAmountMinor,
    unverifiedAmountMinor,
    unverifiedCreditMinor,
    confirmedOutstandingMinor,
    totalDisplayedExposureMinor,
    overpaymentMinor,
    sourceFingerprint: fingerprint(currency, inputEvents, disputes),
    explanation,
    userExplanation: `The confirmed balance is ${confirmedOutstandingMinor.toString()} minor units. ` +
      `${disputedAmountMinor.toString()} minor units are disputed and ${unverifiedAmountMinor.toString()} minor units are unverified potential charges. ` +
      `Unverified credits or payment claims (${unverifiedCreditMinor.toString()} minor units) have not reduced the confirmed balance.`,
  };
}

export function serializeDebtTruth(balance: DebtTruthBalance) {
  return {
    currency: balance.currency,
    originalPrincipalMinor: balance.originalPrincipalMinor.toString(),
    invoicedAmountMinor: balance.invoicedAmountMinor.toString(),
    approvedAdjustmentsMinor: balance.approvedAdjustmentsMinor.toString(),
    approvedFeesMinor: balance.approvedFeesMinor.toString(),
    creditNotesMinor: balance.creditNotesMinor.toString(),
    confirmedPaymentsMinor: balance.confirmedPaymentsMinor.toString(),
    disputedAmountMinor: balance.disputedAmountMinor.toString(),
    unverifiedAmountMinor: balance.unverifiedAmountMinor.toString(),
    unverifiedCreditMinor: balance.unverifiedCreditMinor.toString(),
    confirmedOutstandingMinor: balance.confirmedOutstandingMinor.toString(),
    totalDisplayedExposureMinor: balance.totalDisplayedExposureMinor.toString(),
    overpaymentMinor: balance.overpaymentMinor.toString(),
    sourceFingerprint: balance.sourceFingerprint,
    explanation: balance.explanation,
    userExplanation: balance.userExplanation,
  };
}
