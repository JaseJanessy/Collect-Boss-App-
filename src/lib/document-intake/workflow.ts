import { z } from "zod";

export const transactionNatures = [
  "loan_disbursement", "repayment", "partial_repayment", "refund",
  "deposit_or_other", "collection_case",
] as const;
export type TransactionNature = typeof transactionNatures[number];

export const workflowSteps = [
  "ai_result", "transaction_nature", "profile_match", "required_details",
  "duplicate_review", "review_create", "success",
] as const;

const nullableText = (maximum: number) => z.string().trim().max(maximum).nullable().optional();
const newProfileSchema = z.object({
  debtorType: z.enum(["individual", "business"]),
  name: z.string().trim().min(1).max(160),
  contactName: nullableText(160),
  registrationNo: nullableText(100),
  email: z.string().trim().email().max(254).nullable().optional(),
  phone: nullableText(50),
  address: nullableText(500),
}).strict();

export const transactionWorkflowDraftSchema = z.object({
  step: z.enum(workflowSteps),
  expectedVersion: z.number().int().positive(),
  transactionNature: z.enum(transactionNatures).nullable().optional(),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  currency: z.string().trim().length(3).regex(/^[A-Za-z]{3}$/u).transform((value) => value.toUpperCase()).nullable().optional(),
  transactionDate: nullableText(32),
  reference: nullableText(255),
  externalTransactionId: nullableText(255),
  bank: nullableText(255),
  sender: nullableText(255),
  recipient: nullableText(255),
  externalProvider: nullableText(40),
  externalCustomerId: nullableText(255),
  profileDecision: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("existing"), customerId: z.string().uuid() }).strict(),
    z.object({ kind: z.literal("new"), profile: newProfileSchema }).strict(),
  ]).nullable().optional(),
  accountId: z.string().uuid().nullable().optional(),
  obligationId: z.string().uuid().nullable().optional(),
  caseId: z.string().trim().min(1).max(64).nullable().optional(),
  originalPaymentId: z.string().uuid().nullable().optional(),
  dueDate: z.string().date().nullable().optional(),
  createCollectionCase: z.boolean().default(false),
  paymentMethod: z.enum(["duitnow_qr", "bank_transfer", "cash", "cheque", "tng_ewallet"]).default("bank_transfer"),
  duplicateReview: z.object({
    acknowledged: z.boolean(),
    candidateKeys: z.array(z.string().trim().min(1).max(180)).max(100),
    decision: z.enum(["continue_separate", "link_existing", "not_duplicate"]),
  }).strict().nullable().optional(),
  notes: nullableText(2000),
}).strict();

export type TransactionWorkflowDraft = z.infer<typeof transactionWorkflowDraftSchema>;

export type ProfileIdentity = {
  name?: string | null;
  registrationNo?: string | null;
  email?: string | null;
  phone?: string | null;
  externalProvider?: string | null;
  externalCustomerId?: string | null;
};

export type ProfileMatchSource = ProfileIdentity & {
  id: string;
  accountDisplayData?: string[];
  externalMappings?: Array<{ provider: string; externalCustomerId: string }>;
};

export type ProfileMatch = {
  customerId: string;
  confidence: number;
  reasons: string[];
  strongIdentifierMatch: boolean;
};

export function normalizeRegistration(value?: string | null) {
  return value?.normalize("NFKC").replace(/[^a-z0-9]/giu, "").toUpperCase() ?? "";
}

export function normalizeEmail(value?: string | null) {
  return value?.normalize("NFKC").trim().toLocaleLowerCase() ?? "";
}

export function normalizePhone(value?: string | null) {
  return value?.replace(/\D/gu, "") ?? "";
}

function normalizeName(value?: string | null) {
  return value?.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase() ?? "";
}

export function rankProfileMatches(input: ProfileIdentity, candidates: ProfileMatchSource[]): ProfileMatch[] {
  const registration = normalizeRegistration(input.registrationNo);
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const name = normalizeName(input.name);
  return candidates.flatMap((candidate) => {
    const reasons: string[] = [];
    let confidence = 0;
    let strongIdentifierMatch = false;
    const external = input.externalProvider && input.externalCustomerId && candidate.externalMappings?.some((mapping) =>
      mapping.provider === input.externalProvider && mapping.externalCustomerId === input.externalCustomerId);
    if (external) { reasons.push("Provider customer ID matches"); confidence = 1; strongIdentifierMatch = true; }
    if (registration && registration === normalizeRegistration(candidate.registrationNo)) {
      reasons.push("Registration identifier matches"); confidence = Math.max(confidence, 0.98); strongIdentifierMatch = true;
    }
    if (email && email === normalizeEmail(candidate.email)) {
      reasons.push("Verified email matches"); confidence = Math.max(confidence, 0.94); strongIdentifierMatch = true;
    }
    if (phone.length >= 7 && phone === normalizePhone(candidate.phone)) {
      reasons.push("Phone number matches"); confidence = Math.max(confidence, 0.9); strongIdentifierMatch = true;
    }
    if (name && name === normalizeName(candidate.name)) {
      reasons.push("Name is similar; confirm manually"); confidence = Math.max(confidence, 0.45);
    }
    return reasons.length ? [{ customerId: candidate.id, confidence, reasons, strongIdentifierMatch }] : [];
  }).sort((left, right) => right.confidence - left.confidence || left.customerId.localeCompare(right.customerId));
}

export type DuplicateFingerprint = {
  key: string;
  evidenceSha256?: string | null;
  normalizedReference?: string | null;
  externalTransactionId?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
  transactionDate?: string | null;
  partyHint?: string | null;
  documentKind?: string | null;
  perceptualHash?: string | null;
};

export type DuplicateMatch = { candidateKey: string; confidence: "exact" | "probable" | "near"; reasons: string[] };

export function findTransactionDuplicates(input: DuplicateFingerprint, candidates: DuplicateFingerprint[]): DuplicateMatch[] {
  return candidates.flatMap((candidate) => {
    const reasons: string[] = [];
    let confidence: DuplicateMatch["confidence"] | null = null;
    if (input.evidenceSha256 && input.evidenceSha256 === candidate.evidenceSha256) {
      reasons.push("Exact file SHA-256 match"); confidence = "exact";
    }
    const referenceMatch = Boolean(
      (input.externalTransactionId && input.externalTransactionId === candidate.externalTransactionId)
      || (input.normalizedReference && input.normalizedReference === candidate.normalizedReference),
    );
    if (referenceMatch) { reasons.push("Transaction reference matches"); confidence ??= "exact"; }
    const tupleMatch = input.amountMinor != null && input.amountMinor === candidate.amountMinor
      && input.currency === candidate.currency && input.transactionDate === candidate.transactionDate
      && input.partyHint === candidate.partyHint && input.documentKind === candidate.documentKind;
    if (tupleMatch) { reasons.push("Amount, currency, date, party, and document type match"); confidence ??= "probable"; }
    if (input.perceptualHash && input.perceptualHash === candidate.perceptualHash) {
      reasons.push("Image appears visually identical"); confidence ??= "near";
    }
    return confidence ? [{ candidateKey: candidate.key, confidence, reasons }] : [];
  });
}

export function workflowSubmissionError(draft: TransactionWorkflowDraft, duplicateCount: number): string | null {
  if (!draft.transactionNature) return "Choose the transaction nature.";
  if (!draft.profileDecision) return "Choose an existing profile or explicitly create a new profile.";
  if (!draft.amountMinor || !draft.currency) return "Confirm a positive amount and currency.";
  if (duplicateCount > 0 && (!draft.duplicateReview?.acknowledged || draft.duplicateReview.candidateKeys.length === 0)) {
    return "Review the possible duplicate transaction before submitting.";
  }
  if (draft.transactionNature === "loan_disbursement" && !draft.dueDate) return "Add the obligation due date.";
  if (["repayment", "partial_repayment"].includes(draft.transactionNature) && (!draft.caseId || !draft.obligationId)) {
    return "Choose the existing obligation and its collection case.";
  }
  if (draft.transactionNature === "refund" && !draft.originalPaymentId) return "Choose the original approved payment to reverse.";
  if (draft.transactionNature === "collection_case" && (!draft.dueDate || !draft.reference || !draft.createCollectionCase)) {
    return "Confirm the due date, reference, and explicit collection-case instruction.";
  }
  return null;
}
