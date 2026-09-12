export const classifiedDocumentKinds = [
  "online_bank_transfer_receipt",
  "transaction_screenshot",
  "bank_in_cash_deposit_receipt",
  "bank_statement",
  "payment_receipt",
  "invoice",
  "credit_note",
  "purchase_order",
  "delivery_order",
  "contract",
  "communication_record",
  "unknown_or_other",
] as const;

export type ClassifiedDocumentKind = (typeof classifiedDocumentKinds)[number];

export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type EvidenceLocation = {
  source: "pdf_text_layer" | "ocr";
  page: number | null;
  imageId: string | null;
  snippet: string;
  boundingBox?: BoundingBox;
  textSpan?: { start: number; end: number };
};

export const candidateFieldTypes = [
  "company_name", "debtor_name", "company_identifier", "debtor_identifier",
  "invoice_number", "issue_date", "due_date", "amount", "tax", "currency",
  "bank_reference", "transaction_date", "credit_note_value", "contract_term",
  "account_reference", "line_item_amount", "document_total",
] as const;

export type CandidateFieldType = (typeof candidateFieldTypes)[number];
export type CandidateValidationFlag =
  | "IMPOSSIBLE_DATE" | "AMBIGUOUS_DATE" | "MALFORMED_CURRENCY"
  | "DUPLICATE_INVOICE_IDENTIFIER" | "TOTAL_DOES_NOT_RECONCILE";

export type FieldCandidate = {
  field_type: CandidateFieldType;
  original_text: string;
  normalized_value: string | { currency: string; minor_units: number };
  confidence: number;
  evidence: EvidenceLocation;
  validation_flags: CandidateValidationFlag[];
  sensitivity: "standard" | "sensitive_identifier";
  duplicate_group?: string;
};

export type ExtractedLine = {
  text: string;
  confidence: number | null;
  boundingBox?: BoundingBox;
};

export type ExtractedPage = {
  page: number | null;
  imageId: string | null;
  text: string;
  lines: ExtractedLine[];
};

export type AmountCandidate = {
  minor_units: number;
  currency: string;
  label: string;
  confidence: number;
  evidence: EvidenceLocation;
  recognized_string: string;
};

export type TextCandidate = {
  value: string;
  confidence: number;
  evidence: EvidenceLocation;
};

export type StructuredExtraction = {
  document_kind: { value: ClassifiedDocumentKind; confidence: number };
  amount_candidates: AmountCandidate[];
  transaction_date_candidates: TextCandidate[];
  reference_candidates: TextCandidate[];
  bank_candidates: TextCandidate[];
  sender_candidates: TextCandidate[];
  recipient_candidates: TextCandidate[];
  status_candidates: TextCandidate[];
  field_candidates: FieldCandidate[];
  reconciliation: {
    available: boolean;
    reconciles: boolean | null;
    line_item_minor_units: number | null;
    total_minor_units: number | null;
    currency: string | null;
  };
  warnings: string[];
  parser_version: string;
};

export type OcrRequest = {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg";
  page: number | null;
  imageId: string;
};

export type OcrPageResult = {
  page: number | null;
  imageId: string;
  text: string;
  lines: ExtractedLine[];
  language?: string | null;
  raw: unknown;
};

export interface OcrProvider {
  readonly name: string;
  readonly model: string;
  readonly version: string;
  extract(request: OcrRequest, signal: AbortSignal): Promise<OcrPageResult>;
}

export type NativePdfExtraction = {
  pageCount: number;
  pages: ExtractedPage[];
  usable: boolean;
  rawCharacterCount: number;
};

export type DocumentExtractionOutput = {
  provider: string;
  providerModel: string;
  providerVersion: string;
  parserVersion: string;
  extractionMethod: "pdf_text_layer" | "ocr";
  result: StructuredExtraction;
  protectedRawResult: Record<string, unknown>;
  confidence: number;
  needsReview: boolean;
};
