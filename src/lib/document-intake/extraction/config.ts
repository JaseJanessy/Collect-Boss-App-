const positiveInteger = (value: string | undefined, fallback: number, maximum: number) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};

const unitConfidence = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
};

export const extractionConfig = {
  maxPages: positiveInteger(process.env.DOCUMENT_EXTRACTION_MAX_PAGES, 10, 100),
  maxOcrPages: positiveInteger(process.env.DOCUMENT_OCR_MAX_PAGES, 5, 25),
  maxAmountCandidates: positiveInteger(process.env.DOCUMENT_EXTRACTION_MAX_AMOUNT_CANDIDATES, 12, 50),
  minimumNativeTextCharacters: positiveInteger(process.env.DOCUMENT_PDF_MIN_TEXT_CHARACTERS, 24, 2_000),
  minimumClassificationConfidence: unitConfidence(process.env.DOCUMENT_CLASSIFICATION_MIN_CONFIDENCE, 0.7),
  providerTimeoutMs: positiveInteger(process.env.DOCUMENT_OCR_TIMEOUT_MS, 20_000, 60_000),
  providerAttempts: positiveInteger(process.env.DOCUMENT_OCR_REQUEST_ATTEMPTS, 2, 3),
  jobMaxAttempts: positiveInteger(process.env.DOCUMENT_EXTRACTION_JOB_ATTEMPTS, 3, 5),
  jobsPerRun: positiveInteger(process.env.DOCUMENT_EXTRACTION_JOBS_PER_RUN, 3, 20),
  maximumRawResultCharacters: positiveInteger(process.env.DOCUMENT_EXTRACTION_MAX_RAW_CHARACTERS, 250_000, 1_000_000),
} as const;

export const EXTRACTION_PARSER_VERSION = "collectboss-document-parser/2.0.0";
export const PDF_TEXT_PARSER_VERSION = "pdfjs-dist/6.2.108";
