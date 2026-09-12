import type { EvidenceLocation, StructuredExtraction } from "./extraction/types";

export const transactionNatures = [
  "loan_disbursement",
  "repayment",
  "partial_repayment",
  "refund",
  "deposit",
  "fee_adjustment",
  "other",
] as const;

export const transactionStatuses = ["successful", "pending", "failed", "unknown"] as const;

export type TransactionNature = (typeof transactionNatures)[number];
export type TransactionStatus = (typeof transactionStatuses)[number];

export type ReviewExtraction = {
  id: string;
  evidenceId: string;
  extractionVersion: number | null;
  documentVersion: number | null;
  status: string;
  documentKind: string | null;
  classificationConfidence: number | null;
  structuredResult: StructuredExtraction | Record<string, unknown> | null;
  parserVersion: string;
  provider: string;
  providerModel: string | null;
  providerVersion: string | null;
  extractionMethod: string | null;
  completedAt: string | null;
};

export type ReviewChoice = {
  mode: "candidate" | "manual";
  candidateId?: string;
  value?: string;
  reason?: string;
};

export type AmountReviewChoice = {
  mode: "candidate" | "manual";
  candidateId?: string;
  amountMinor?: number;
  recognizedValue?: string;
  reason?: string;
};

export type DateReviewChoice = ReviewChoice & {
  interpretedDateTime?: string;
  timezone?: string;
  confirmed?: boolean;
};

export type DocumentReviewInput = {
  documentKind?: string | null;
  documentKindReason?: string | null;
  representsFinancialMovement?: boolean | null;
  amount?: AmountReviewChoice | null;
  currency?: string | null;
  currencyConfirmed?: boolean;
  date?: DateReviewChoice | null;
  reference?: ReviewChoice | null;
  bank?: ReviewChoice | null;
  sender?: ReviewChoice | null;
  recipient?: ReviewChoice | null;
  transactionStatus?: TransactionStatus | null;
  transactionNature?: TransactionNature | null;
  transactionNatureNote?: string | null;
  notes?: string | null;
};

export type ReviewIssue = {
  field: string;
  code: string;
  message: string;
};

export type Citation = EvidenceLocation & {
  field: string;
  candidateId: string;
};

export type ReviewAmountCandidate = {
  candidateId: string;
  minorUnits: number;
  currency: string;
  label: string;
  confidence: number;
  recognizedValue: string;
  evidence: EvidenceLocation;
  recommended: boolean;
};

export type ReviewTextCandidate = {
  candidateId: string;
  value: string;
  confidence: number;
  evidence: EvidenceLocation;
};

export type ReviewWorkspace = {
  extractionId: string | null;
  evidenceId: string | null;
  proposedDocumentKind: string | null;
  classificationConfidence: number | null;
  amountCandidates: ReviewAmountCandidate[];
  dateCandidates: ReviewTextCandidate[];
  referenceCandidates: ReviewTextCandidate[];
  bankCandidates: ReviewTextCandidate[];
  senderCandidates: ReviewTextCandidate[];
  recipientCandidates: ReviewTextCandidate[];
  statusCandidates: ReviewTextCandidate[];
  warnings: string[];
  recommendedAmountCandidateId: string | null;
  requiresDocumentKindReview: boolean;
};

type PersistedDecision = {
  source: "candidate" | "manual" | "user";
  candidate_id: string | null;
  original_value: string | number | null;
  confirmed_value: string | number | boolean | null;
  confidence: number | null;
  reason: string | null;
  evidence: EvidenceLocation | null;
};

export type PreparedReview = {
  extraction_id: string | null;
  review_status: "draft" | "confirmed";
  document_kind: string | null;
  document_kind_confidence: number | null;
  represents_financial_movement: boolean | null;
  amount_minor: number | null;
  currency: string | null;
  transaction_datetime: string | null;
  timezone: string | null;
  reference: string | null;
  bank: string | null;
  sender: string | null;
  recipient: string | null;
  transaction_status: TransactionStatus | null;
  transaction_nature: TransactionNature | null;
  transaction_nature_note: string | null;
  notes: string | null;
  chosen_amount_candidate_id: string | null;
  chosen_amount_original: string | null;
  manual_amount_reason: string | null;
  reference_original: string | null;
  currency_confirmed: boolean;
  date_interpretation_confirmed: boolean;
  field_decisions: Record<string, PersistedDecision>;
  evidence_citations: Citation[];
  validation_issues: ReviewIssue[];
};

const discouragedAmountLabels = new Set(["available_balance", "balance", "daily_limit", "limit", "fee", "total_debit"]);
const amountLabelScores: Record<string, number> = {
  transfer_amount: 100,
  payment_amount: 95,
  amount_paid: 95,
  deposit_amount: 90,
  transaction_amount: 85,
  invoice_total: 75,
  document_total: 70,
  amount: 40,
  total_debit: 10,
  fee: 5,
  available_balance: 0,
  balance: 0,
  daily_limit: 0,
  limit: 0,
};

const trimOrNull = (value: string | null | undefined) => value?.trim() || null;
const asStructured = (value: ReviewExtraction["structuredResult"]): Partial<StructuredExtraction> =>
  value && typeof value === "object" ? value as Partial<StructuredExtraction> : {};

function textCandidates(
  values: Array<{ value: string; confidence: number; evidence: EvidenceLocation }> | undefined,
  prefix: string,
): ReviewTextCandidate[] {
  return (values ?? []).map((candidate, index) => ({
    candidateId: `${prefix}:${index}`,
    value: candidate.value,
    confidence: candidate.confidence,
    evidence: candidate.evidence,
  }));
}

function rankedAmountScore(candidate: ReviewAmountCandidate, proposedKind: string | null, contextCurrency: string | null) {
  const transactionDocument = proposedKind !== null && [
    "online_bank_transfer_receipt", "transaction_screenshot", "bank_in_cash_deposit_receipt", "payment_receipt",
  ].includes(proposedKind);
  return (amountLabelScores[candidate.label] ?? 30)
    + candidate.confidence * 10
    + (candidate.currency === contextCurrency ? 6 : 0)
    + (candidate.evidence.page === 1 ? 3 : 0)
    + (candidate.evidence.boundingBox ? 2 : 0)
    + (candidate.evidence.source === "pdf_text_layer" ? 1 : 0)
    + (transactionDocument && ["transfer_amount", "payment_amount", "deposit_amount", "transaction_amount"].includes(candidate.label) ? 8 : 0);
}

export function buildReviewWorkspace(extraction: ReviewExtraction | null): ReviewWorkspace {
  if (!extraction) {
    return {
      extractionId: null, evidenceId: null, proposedDocumentKind: null, classificationConfidence: null,
      amountCandidates: [], dateCandidates: [], referenceCandidates: [], bankCandidates: [], senderCandidates: [],
      recipientCandidates: [], statusCandidates: [], warnings: [], recommendedAmountCandidateId: null,
      requiresDocumentKindReview: true,
    };
  }
  const result = asStructured(extraction.structuredResult);
  const amounts: ReviewAmountCandidate[] = (result.amount_candidates ?? []).map((candidate, index) => ({
    candidateId: `amount:${index}`,
    minorUnits: candidate.minor_units,
    currency: candidate.currency,
    label: candidate.label,
    confidence: candidate.confidence,
    recognizedValue: candidate.recognized_string,
    evidence: candidate.evidence,
    recommended: false,
  }));
  const currencyCounts = new Map<string, number>();
  for (const candidate of amounts) currencyCounts.set(candidate.currency, (currencyCounts.get(candidate.currency) ?? 0) + 1);
  const contextCurrency = [...currencyCounts].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
  const proposedKind = result.document_kind?.value ?? extraction.documentKind;
  const eligible = amounts.filter((candidate) => !discouragedAmountLabels.has(candidate.label));
  const recommended = [...eligible].sort((left, right) =>
    rankedAmountScore(right, proposedKind ?? null, contextCurrency) - rankedAmountScore(left, proposedKind ?? null, contextCurrency),
  )[0] ?? null;
  for (const candidate of amounts) candidate.recommended = candidate.candidateId === recommended?.candidateId;
  const warnings = Array.isArray(result.warnings) ? result.warnings.filter((item): item is string => typeof item === "string") : [];
  const confidence = result.document_kind?.confidence ?? extraction.classificationConfidence;
  return {
    extractionId: extraction.id,
    evidenceId: extraction.evidenceId,
    proposedDocumentKind: proposedKind ?? null,
    classificationConfidence: confidence ?? null,
    amountCandidates: amounts,
    dateCandidates: textCandidates(result.transaction_date_candidates, "date"),
    referenceCandidates: textCandidates(result.reference_candidates, "reference"),
    bankCandidates: textCandidates(result.bank_candidates, "bank"),
    senderCandidates: textCandidates(result.sender_candidates, "sender"),
    recipientCandidates: textCandidates(result.recipient_candidates, "recipient"),
    statusCandidates: textCandidates(result.status_candidates, "status"),
    warnings,
    recommendedAmountCandidateId: recommended?.candidateId ?? null,
    requiresDocumentKindReview: !proposedKind || proposedKind === "unknown_or_other" || (confidence ?? 0) < 0.8,
  };
}

function findTextCandidate(workspace: ReviewWorkspace, field: keyof Pick<ReviewWorkspace,
  "dateCandidates" | "referenceCandidates" | "bankCandidates" | "senderCandidates" | "recipientCandidates" | "statusCandidates">,
candidateId: string | undefined) {
  return candidateId ? workspace[field].find((candidate) => candidate.candidateId === candidateId) ?? null : null;
}

function addTextDecision(input: {
  key: "reference" | "bank" | "sender" | "recipient";
  choice: ReviewChoice | null | undefined;
  candidates: "referenceCandidates" | "bankCandidates" | "senderCandidates" | "recipientCandidates";
  workspace: ReviewWorkspace;
  decisions: Record<string, PersistedDecision>;
  citations: Citation[];
  issues: ReviewIssue[];
}) {
  if (!input.choice) return null;
  if (input.choice.mode === "candidate") {
    const candidate = findTextCandidate(input.workspace, input.candidates, input.choice.candidateId);
    if (!candidate) {
      input.issues.push({ field: input.key, code: "CANDIDATE_NOT_FOUND", message: `Choose a valid ${input.key} candidate.` });
      return null;
    }
    input.decisions[input.key] = {
      source: "candidate", candidate_id: candidate.candidateId, original_value: candidate.value,
      confirmed_value: candidate.value, confidence: candidate.confidence, reason: null, evidence: candidate.evidence,
    };
    input.citations.push({ ...candidate.evidence, field: input.key, candidateId: candidate.candidateId });
    return candidate.value;
  }
  const value = trimOrNull(input.choice.value);
  if (!value) return null;
  const originalCandidate = input.workspace[input.candidates][0] ?? null;
  const reason = trimOrNull(input.choice.reason);
  if (originalCandidate && !reason) {
    input.issues.push({ field: input.key, code: "MANUAL_REASON_REQUIRED", message: `Explain why the extracted ${input.key} is incorrect.` });
  }
  input.decisions[input.key] = {
    source: "manual", candidate_id: null, original_value: originalCandidate?.value ?? null, confirmed_value: value,
    confidence: null, reason, evidence: null,
  };
  return value;
}

export function prepareDocumentReview(input: DocumentReviewInput, workspace: ReviewWorkspace, options: {
  confirm: boolean;
  supportedCurrencies: string[];
}): PreparedReview {
  const issues: ReviewIssue[] = [];
  const decisions: Record<string, PersistedDecision> = {};
  const citations: Citation[] = [];
  const documentKind = trimOrNull(input.documentKind);
  const documentKindReason = trimOrNull(input.documentKindReason);
  if (!documentKind && options.confirm) issues.push({ field: "documentKind", code: "DOCUMENT_KIND_REQUIRED", message: "Confirm the document kind." });
  if (documentKind && workspace.proposedDocumentKind && documentKind !== workspace.proposedDocumentKind && !documentKindReason) {
    issues.push({ field: "documentKind", code: "CORRECTION_REASON_REQUIRED", message: "Explain why the document kind was changed." });
  }
  if (documentKind) {
    decisions.document_kind = {
      source: "user", candidate_id: "document_kind", original_value: workspace.proposedDocumentKind,
      confirmed_value: documentKind, confidence: workspace.classificationConfidence, reason: documentKindReason, evidence: null,
    };
  }

  const movement = input.representsFinancialMovement ?? null;
  if (movement === null && options.confirm) issues.push({ field: "representsFinancialMovement", code: "MOVEMENT_CONFIRMATION_REQUIRED", message: "Confirm whether this document represents a financial movement." });

  let amountMinor: number | null = null;
  let currency = trimOrNull(input.currency)?.toUpperCase() ?? null;
  let amountCandidateId: string | null = null;
  let amountOriginal: string | null = null;
  let manualAmountReason: string | null = null;
  if (input.amount?.mode === "candidate") {
    const candidate = workspace.amountCandidates.find((item) => item.candidateId === input.amount?.candidateId) ?? null;
    if (!candidate) {
      issues.push({ field: "amount", code: "CANDIDATE_NOT_FOUND", message: "Choose a valid amount candidate." });
    } else {
      amountMinor = candidate.minorUnits;
      currency = currency ?? candidate.currency;
      amountCandidateId = candidate.candidateId;
      amountOriginal = candidate.recognizedValue;
      decisions.amount = {
        source: "candidate", candidate_id: candidate.candidateId, original_value: candidate.recognizedValue,
        confirmed_value: candidate.minorUnits, confidence: candidate.confidence, reason: null, evidence: candidate.evidence,
      };
      citations.push({ ...candidate.evidence, field: "amount", candidateId: candidate.candidateId });
      if (currency !== candidate.currency) issues.push({ field: "currency", code: "CURRENCY_CANDIDATE_MISMATCH", message: "The confirmed currency must match the selected amount candidate." });
    }
  } else if (input.amount?.mode === "manual") {
    amountMinor = Number.isSafeInteger(input.amount.amountMinor) ? input.amount.amountMinor ?? null : null;
    amountOriginal = trimOrNull(input.amount.recognizedValue);
    manualAmountReason = trimOrNull(input.amount.reason);
    if (!manualAmountReason) issues.push({ field: "amount", code: "MANUAL_REASON_REQUIRED", message: "Explain why none of the extracted amounts is correct." });
    decisions.amount = {
      source: "manual", candidate_id: null, original_value: amountOriginal, confirmed_value: amountMinor,
      confidence: null, reason: manualAmountReason, evidence: null,
    };
  }
  if (movement && options.confirm && amountMinor === null) issues.push({ field: "amount", code: "AMOUNT_REQUIRED", message: "Choose an amount candidate or enter the amount manually." });
  if (amountMinor !== null && (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)) issues.push({ field: "amount", code: "INVALID_AMOUNT", message: "Transaction amounts must be positive integer minor units." });
  if (movement && options.confirm && !currency) issues.push({ field: "currency", code: "CURRENCY_REQUIRED", message: "Confirm the currency explicitly." });
  if (currency && !/^[A-Z]{3}$/u.test(currency)) issues.push({ field: "currency", code: "INVALID_CURRENCY", message: "Use a three-letter currency code." });
  if (currency && !options.supportedCurrencies.includes(currency)) issues.push({ field: "currency", code: "UNSUPPORTED_CURRENCY", message: `${currency} is not enabled for this business.` });
  if (movement && options.confirm && !input.currencyConfirmed) issues.push({ field: "currency", code: "CURRENCY_CONFIRMATION_REQUIRED", message: "Explicitly confirm the currency." });
  if (currency) decisions.currency = {
    source: "user", candidate_id: amountCandidateId, original_value: input.amount?.mode === "candidate"
      ? workspace.amountCandidates.find((item) => item.candidateId === amountCandidateId)?.currency ?? null : null,
    confirmed_value: currency, confidence: null, reason: null, evidence: decisions.amount?.evidence ?? null,
  };

  let transactionDatetime: string | null = null;
  let timezone: string | null = null;
  let dateConfirmed = false;
  if (input.date) {
    timezone = trimOrNull(input.date.timezone);
    transactionDatetime = trimOrNull(input.date.interpretedDateTime);
    dateConfirmed = input.date.confirmed === true;
    let original: string | null = null;
    let confidence: number | null = null;
    let evidence: EvidenceLocation | null = null;
    if (input.date.mode === "candidate") {
      const candidate = findTextCandidate(workspace, "dateCandidates", input.date.candidateId);
      if (!candidate) issues.push({ field: "date", code: "CANDIDATE_NOT_FOUND", message: "Choose a valid date candidate." });
      else {
        original = candidate.value; confidence = candidate.confidence; evidence = candidate.evidence;
        citations.push({ ...candidate.evidence, field: "date", candidateId: candidate.candidateId });
      }
    } else if (!trimOrNull(input.date.reason)) {
      issues.push({ field: "date", code: "MANUAL_REASON_REQUIRED", message: "Explain why the date was entered manually." });
    }
    if (transactionDatetime && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(transactionDatetime)
      || !Number.isFinite(Date.parse(transactionDatetime)))) {
      issues.push({ field: "date", code: "INVALID_DATE", message: "Enter an ISO date and time with an explicit offset." });
    }
    decisions.date = {
      source: input.date.mode, candidate_id: input.date.candidateId ?? null, original_value: original,
      confirmed_value: transactionDatetime, confidence, reason: trimOrNull(input.date.reason), evidence,
    };
  }
  if (movement && options.confirm && !transactionDatetime) issues.push({ field: "date", code: "DATE_REQUIRED", message: "Confirm the transaction date and time." });
  if (movement && options.confirm && !timezone) issues.push({ field: "date", code: "TIMEZONE_REQUIRED", message: "Confirm the timezone used to interpret the date." });
  if (movement && options.confirm && !dateConfirmed) issues.push({ field: "date", code: "DATE_CONFIRMATION_REQUIRED", message: "Confirm the displayed date interpretation." });

  const reference = addTextDecision({ key: "reference", choice: input.reference, candidates: "referenceCandidates", workspace, decisions, citations, issues });
  const bank = addTextDecision({ key: "bank", choice: input.bank, candidates: "bankCandidates", workspace, decisions, citations, issues });
  const sender = addTextDecision({ key: "sender", choice: input.sender, candidates: "senderCandidates", workspace, decisions, citations, issues });
  const recipient = addTextDecision({ key: "recipient", choice: input.recipient, candidates: "recipientCandidates", workspace, decisions, citations, issues });
  const nature = input.transactionNature ?? null;
  const natureNote = trimOrNull(input.transactionNatureNote);
  if (movement && options.confirm && !nature) issues.push({ field: "transactionNature", code: "TRANSACTION_NATURE_REQUIRED", message: "Choose the transaction nature." });
  if (nature === "other" && !natureNote) issues.push({ field: "transactionNature", code: "TRANSACTION_NATURE_NOTE_REQUIRED", message: "Add a note for the other transaction nature." });
  if (nature) decisions.transaction_nature = {
    source: "user", candidate_id: null, original_value: null, confirmed_value: nature,
    confidence: null, reason: natureNote, evidence: null,
  };

  return {
    extraction_id: workspace.extractionId,
    review_status: options.confirm && issues.length === 0 ? "confirmed" : "draft",
    document_kind: documentKind,
    document_kind_confidence: workspace.classificationConfidence,
    represents_financial_movement: movement,
    amount_minor: amountMinor,
    currency,
    transaction_datetime: transactionDatetime,
    timezone,
    reference,
    bank,
    sender,
    recipient,
    transaction_status: input.transactionStatus ?? null,
    transaction_nature: nature,
    transaction_nature_note: natureNote,
    notes: trimOrNull(input.notes),
    chosen_amount_candidate_id: amountCandidateId,
    chosen_amount_original: amountOriginal,
    manual_amount_reason: manualAmountReason,
    reference_original: decisions.reference?.original_value?.toString() ?? null,
    currency_confirmed: input.currencyConfirmed === true,
    date_interpretation_confirmed: dateConfirmed,
    field_decisions: decisions,
    evidence_citations: citations,
    validation_issues: issues,
  };
}
