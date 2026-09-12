export const confidenceBands = ["high", "ambiguous", "low"] as const;
export type ConfidenceBand = typeof confidenceBands[number];

export interface MatchingThresholds {
  highConfidence: number;
  ambiguous: number;
  dateWindowDays: number;
  maximumCandidates: number;
}

export const defaultMatchingThresholds: MatchingThresholds = {
  highConfidence: 75,
  ambiguous: 45,
  dateWindowDays: 14,
  maximumCandidates: 10,
};

export interface NormalizedPaymentTransaction {
  id: string;
  amountMinor: number;
  currency: string;
  occurredAt: string | null;
  reference: string | null;
  invoiceNumber: string | null;
  partyName: string | null;
  accountReference: string | null;
  phone: string | null;
  phoneMatchPermitted: boolean;
}

export interface ExistingPaymentSignal {
  id: string;
  amountMinor: number;
  currency: string;
  reference: string | null;
  reviewStatus: string;
}

export interface PaymentMatchTarget {
  key: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  accountId: string | null;
  accountReference: string | null;
  obligationId: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  outstandingMinor: number;
  currency: string;
  caseId: string;
  priorApprovedPaymentCount: number;
  existingPayments: ExistingPaymentSignal[];
}

export interface MatchSignal {
  code: string;
  label: string;
  weight: number;
}

export interface RankedPaymentCandidate {
  targetKey: string;
  customerId: string;
  accountId: string | null;
  obligationId: string | null;
  caseId: string;
  existingPaymentId: string | null;
  score: number;
  confidenceBand: ConfidenceBand;
  matchedSignals: MatchSignal[];
  conflictingSignals: MatchSignal[];
  reason: string;
  rankingReason: string;
  rank: number;
}

function normalizedText(value: string | null) {
  return value?.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/gu, " ") ?? "";
}

function compactIdentifier(value: string | null) {
  return value?.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/gu, "") ?? "";
}

function normalizedPhone(value: string | null) {
  return value?.replace(/\D/gu, "") ?? "";
}

function daysBetween(left: string, right: string) {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime)
    ? Math.abs(leftTime - rightTime) / 86_400_000
    : Number.POSITIVE_INFINITY;
}

function matchingExistingPayment(transaction: NormalizedPaymentTransaction, target: PaymentMatchTarget) {
  const reference = compactIdentifier(transaction.reference);
  return target.existingPayments
    .filter((payment) => payment.currency === transaction.currency)
    .sort((left, right) => {
      const leftReference = reference.length >= 4 && compactIdentifier(left.reference) === reference ? 1 : 0;
      const rightReference = reference.length >= 4 && compactIdentifier(right.reference) === reference ? 1 : 0;
      return rightReference - leftReference || Number(right.amountMinor === transaction.amountMinor) - Number(left.amountMinor === transaction.amountMinor);
    })[0] ?? null;
}

function bandFor(score: number, settings: MatchingThresholds): ConfidenceBand {
  if (score >= settings.highConfidence) return "high";
  if (score >= settings.ambiguous) return "ambiguous";
  return "low";
}

export function rankPaymentCandidates(
  transaction: NormalizedPaymentTransaction,
  targets: PaymentMatchTarget[],
  thresholds: MatchingThresholds = defaultMatchingThresholds,
): RankedPaymentCandidate[] {
  const transactionReference = compactIdentifier(transaction.reference);
  const invoiceNumber = compactIdentifier(transaction.invoiceNumber);
  const accountReference = compactIdentifier(transaction.accountReference);
  const partyName = normalizedText(transaction.partyName);
  const phone = normalizedPhone(transaction.phone);

  const ranked = targets.map((target) => {
    const matchedSignals: MatchSignal[] = [];
    const conflictingSignals: MatchSignal[] = [];
    const addMatch = (code: string, label: string, weight: number) => matchedSignals.push({ code, label, weight });
    const addConflict = (code: string, label: string, weight: number) => conflictingSignals.push({ code, label, weight });

    if (target.currency === transaction.currency) addMatch("currency_exact", "Currency matches", 15);
    else addConflict("currency_conflict", `Currency conflicts (${transaction.currency} vs ${target.currency})`, -100);

    if (transaction.amountMinor === target.outstandingMinor) addMatch("amount_outstanding_exact", "Amount equals the current outstanding balance", 20);
    else if (transaction.amountMinor < target.outstandingMinor) addMatch("amount_partial_plausible", "Amount is a plausible partial payment", 8);
    else addConflict("amount_exceeds_outstanding", "Amount exceeds the current outstanding balance", -12);

    const targetInvoice = compactIdentifier(target.invoiceNumber);
    if (invoiceNumber.length >= 3 && invoiceNumber === targetInvoice) addMatch("invoice_exact", "Invoice number matches exactly", 32);
    if (transactionReference.length >= 4 && transactionReference === targetInvoice) addMatch("reference_invoice_exact", "Transaction reference matches the invoice", 28);

    const targetAccount = compactIdentifier(target.accountReference);
    if (accountReference.length >= 4 && accountReference === targetAccount) addMatch("account_reference_exact", "Account reference matches exactly", 24);

    const targetName = normalizedText(target.customerName);
    if (partyName && partyName === targetName) addMatch("party_name_exact", "Party name matches exactly after normalization", 16);
    else if (partyName && targetName && (partyName.includes(targetName) || targetName.includes(partyName))) {
      addMatch("party_name_partial", "Party name has a deterministic normalized overlap", 8);
    }

    const targetPhone = normalizedPhone(target.customerPhone);
    if (transaction.phoneMatchPermitted && phone.length >= 7 && targetPhone.length >= 7) {
      if (phone === targetPhone) addMatch("phone_exact", "Lawfully available phone number matches", 18);
      else addConflict("phone_conflict", "Available phone numbers conflict", -8);
    }

    if (transaction.occurredAt) {
      const nearestDays = Math.min(
        target.issueDate ? daysBetween(transaction.occurredAt, target.issueDate) : Number.POSITIVE_INFINITY,
        target.dueDate ? daysBetween(transaction.occurredAt, target.dueDate) : Number.POSITIVE_INFINITY,
      );
      if (nearestDays <= 3) addMatch("date_near_invoice", "Transaction date is within 3 days of an invoice date", 10);
      else if (nearestDays <= thresholds.dateWindowDays) addMatch("date_window", `Transaction date is within the ${thresholds.dateWindowDays}-day matching window`, 5);
      if (target.issueDate && Date.parse(transaction.occurredAt) < Date.parse(target.issueDate) - thresholds.dateWindowDays * 86_400_000) {
        addConflict("date_before_issue", "Transaction predates the invoice outside the configured window", -15);
      }
    }

    if (target.priorApprovedPaymentCount > 0) addMatch("prior_payment_pattern", "This account has prior approved payment history", 4);

    const existingPayment = matchingExistingPayment(transaction, target);
    if (existingPayment) {
      const existingReferenceMatches = transactionReference.length >= 4
        && transactionReference === compactIdentifier(existingPayment.reference);
      if (existingReferenceMatches) addMatch("existing_payment_reference", "Reference matches an existing payment record", 20);
      if (existingPayment.amountMinor === transaction.amountMinor) addMatch("existing_payment_amount", "Amount matches an existing payment record", 5);
      if (["approved", "reversed"].includes(existingPayment.reviewStatus)) {
        addConflict("existing_payment_final", "A matching payment record is already final", -55);
      }
    }

    const rawScore = matchedSignals.reduce((sum, signal) => sum + signal.weight, 0)
      + conflictingSignals.reduce((sum, signal) => sum + signal.weight, 0);
    const score = Math.max(0, Math.min(100, rawScore));
    const strongest = [...matchedSignals].sort((left, right) => right.weight - left.weight).slice(0, 3).map((signal) => signal.label);
    const conflictSummary = conflictingSignals.length
      ? ` Conflicts: ${conflictingSignals.map((signal) => signal.label).join("; ")}.`
      : " No conflicting signals were found.";
    return {
      targetKey: target.key,
      customerId: target.customerId,
      accountId: target.accountId,
      obligationId: target.obligationId,
      caseId: target.caseId,
      existingPaymentId: existingPayment?.id ?? null,
      score,
      confidenceBand: bandFor(score, thresholds),
      matchedSignals,
      conflictingSignals,
      reason: strongest.length ? `${strongest.join("; ")}.${conflictSummary}` : `No positive matching signal was found.${conflictSummary}`,
      rankingReason: "",
      rank: 0,
    };
  }).sort((left, right) => right.score - left.score || left.targetKey.localeCompare(right.targetKey))
    .slice(0, thresholds.maximumCandidates);

  return ranked.map((candidate, index) => {
    const leader = ranked[0];
    const next = ranked[index + 1];
    const rankingReason = index === 0
      ? next
        ? `Ranked first at ${candidate.score}; the next alternative scored ${next.score}, ${candidate.score - next.score} points lower.`
        : `Ranked first at ${candidate.score}; no other eligible alternative was found.`
      : `Ranked #${index + 1} at ${candidate.score}, ${leader.score - candidate.score} points below the leading alternative because it has fewer positive signals and/or more conflicts.`;
    return { ...candidate, rank: index + 1, rankingReason };
  });
}

export function queueForCandidates(candidates: RankedPaymentCandidate[], thresholds: MatchingThresholds = defaultMatchingThresholds) {
  const top = candidates[0];
  if (!top || top.score < thresholds.ambiguous) return "unmatched" as const;
  return top.score >= thresholds.highConfidence ? "high_confidence_review" as const : "ambiguous" as const;
}

export interface LabelledMatchExample {
  id: string;
  transaction: NormalizedPaymentTransaction;
  targets: PaymentMatchTarget[];
  expectedTargetKey: string | null;
}

export function evaluatePaymentMatching(examples: LabelledMatchExample[], thresholds = defaultMatchingThresholds) {
  const bands = Object.fromEntries(confidenceBands.map((band) => [band, { predicted: 0, correct: 0, expected: 0 }])) as Record<ConfidenceBand, { predicted: number; correct: number; expected: number }>;
  for (const example of examples) {
    const top = rankPaymentCandidates(example.transaction, example.targets, thresholds)[0];
    if (top) {
      bands[top.confidenceBand].predicted += 1;
      if (top.targetKey === example.expectedTargetKey) bands[top.confidenceBand].correct += 1;
    }
    if (example.expectedTargetKey) {
      const expected = rankPaymentCandidates(example.transaction, example.targets, thresholds)
        .find((candidate) => candidate.targetKey === example.expectedTargetKey);
      if (expected) bands[expected.confidenceBand].expected += 1;
    }
  }
  return Object.fromEntries(confidenceBands.map((band) => {
    const row = bands[band];
    return [band, {
      ...row,
      precision: row.predicted ? row.correct / row.predicted : null,
      recall: row.expected ? row.correct / row.expected : null,
    }];
  })) as Record<ConfidenceBand, { predicted: number; correct: number; expected: number; precision: number | null; recall: number | null }>;
}
