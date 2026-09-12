import { extractionConfig, EXTRACTION_PARSER_VERSION } from "./config";
import type {
  AmountCandidate,
  ClassifiedDocumentKind,
  EvidenceLocation,
  ExtractedPage,
  FieldCandidate,
  StructuredExtraction,
  TextCandidate,
} from "./types";

type ClassificationRule = { kind: ClassifiedDocumentKind; patterns: RegExp[] };

const classificationRules: ClassificationRule[] = [
  { kind: "bank_in_cash_deposit_receipt", patterns: [/cash deposit/iu, /bank[- ]?in/iu, /deposit machine/iu] },
  { kind: "online_bank_transfer_receipt", patterns: [/instant transfer/iu, /duitnow/iu, /funds? transfer/iu, /transfer successful/iu] },
  { kind: "bank_statement", patterns: [/bank statement/iu, /opening balance/iu, /closing balance/iu, /statement period/iu] },
  { kind: "payment_receipt", patterns: [/payment receipt/iu, /official receipt/iu, /amount paid/iu, /payment successful/iu] },
  { kind: "credit_note", patterns: [/credit note/iu, /credit memo/iu] },
  { kind: "purchase_order", patterns: [/purchase order/iu, /\bpo\s*(?:no|number|#)/iu] },
  { kind: "delivery_order", patterns: [/delivery order/iu, /goods received/iu] },
  { kind: "invoice", patterns: [/\binvoice\b/iu, /amount due/iu, /invoice number/iu] },
  { kind: "contract", patterns: [/\bagreement\b/iu, /terms and conditions/iu, /hereinafter/iu] },
  { kind: "communication_record", patterns: [/whatsapp/iu, /email conversation/iu, /subject:/iu, /sent from/iu] },
  { kind: "transaction_screenshot", patterns: [/transaction details/iu, /transaction history/iu, /successful transaction/iu] },
];

const bankPatterns = [
  /Maybank(?: Berhad)?/giu,
  /CIMB(?: Bank)?/giu,
  /Public Bank/giu,
  /RHB(?: Bank)?/giu,
  /Hong Leong Bank/giu,
  /AmBank/giu,
  /Bank Islam/giu,
  /Bank Rakyat/giu,
  /OCBC(?: Bank)?/giu,
  /UOB(?: Bank)?/giu,
  /HSBC/giu,
  /Standard Chartered/giu,
];

function roundConfidence(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 10_000) / 10_000;
}

function locateEvidence(pages: ExtractedPage[], recognized: string): EvidenceLocation {
  const needle = recognized.toLocaleLowerCase();
  for (const page of pages) {
    const line = page.lines.find((candidate) => candidate.text.toLocaleLowerCase().includes(needle));
    const sourceText = line?.text ?? page.text;
    const index = sourceText.toLocaleLowerCase().indexOf(needle);
    if (index >= 0) {
      const start = Math.max(0, index - 60);
      const end = Math.min(sourceText.length, index + recognized.length + 60);
      return {
        source: page.imageId ? "ocr" : "pdf_text_layer",
        page: page.page,
        imageId: page.imageId,
        snippet: sourceText.slice(start, end).replace(/\s+/gu, " ").trim(),
        textSpan: { start: index, end: index + recognized.length },
        ...(line?.boundingBox ? { boundingBox: line.boundingBox } : {}),
      };
    }
  }
  return { source: pages.some((page) => page.imageId) ? "ocr" : "pdf_text_layer", page: null, imageId: null, snippet: recognized };
}

function normalizePartyName(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().replace(/[.,;:]+$/u, "");
}

function parseLocaleMoney(value: string, currencyHint?: string): { currency: string; minor_units: number } | null {
  const currencyMatch = value.match(/\b(MYR|RM|SGD|S\$|USD|US\$|EUR|€|GBP|£)\b/iu);
  const currencyToken = currencyMatch?.[1]?.toUpperCase();
  const currency = currencyToken === "RM" ? "MYR" : currencyToken === "S$" ? "SGD" :
    currencyToken === "US$" ? "USD" : currencyToken === "€" ? "EUR" : currencyToken === "£" ? "GBP" :
      currencyToken ?? currencyHint?.toUpperCase();
  if (!currency || !/^[A-Z]{3}$/u.test(currency)) return null;
  const numeric = value.replace(/(?:MYR|RM|SGD|S\$|USD|US\$|EUR|€|GBP|£)/giu, "").replace(/\s/gu, "").trim();
  if (!/^[-+]?\d[\d.,]*$/u.test(numeric)) return null;
  const unsigned = numeric.replace(/^[-+]/u, "");
  const lastDot = unsigned.lastIndexOf(".");
  const lastComma = unsigned.lastIndexOf(",");
  const separator = Math.max(lastDot, lastComma);
  const hasDecimals = separator >= 0 && unsigned.length - separator - 1 === 2;
  const wholeToken = hasDecimals ? unsigned.slice(0, separator) : unsigned;
  const grouping = wholeToken.match(/[.,]/u)?.[0];
  if (grouping) {
    const escaped = grouping === "." ? "\\." : grouping;
    if (!new RegExp(`^\\d{1,3}(?:${escaped}\\d{3})+$`, "u").test(wholeToken)) return null;
  }
  if (!hasDecimals && separator >= 0 && !grouping) return null;
  const whole = wholeToken.replace(/[.,]/gu, "");
  const fraction = hasDecimals ? unsigned.slice(separator + 1) : "00";
  if (!/^\d+$/u.test(whole) || !/^\d{2}$/u.test(fraction)) return null;
  const minor = BigInt(whole) * 100n + BigInt(fraction);
  const signed = numeric.startsWith("-") ? -minor : minor;
  return signed <= BigInt(Number.MAX_SAFE_INTEGER) && signed >= BigInt(Number.MIN_SAFE_INTEGER)
    ? { currency, minor_units: Number(signed) } : null;
}

function normalizeDate(value: string): { value: string; ambiguous: boolean } | null {
  const cleaned = value.trim().replace(/\./gu, "/");
  let year: number; let month: number; let day: number; let ambiguous = false;
  const iso = cleaned.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/u);
  const local = cleaned.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/u);
  if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (local) {
    day = Number(local[1]); month = Number(local[2]); year = Number(local[3]);
    if (year < 100) year += 2000;
    ambiguous = day <= 12 && month <= 12 && day !== month;
  } else return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { value: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, ambiguous };
}

function fieldCandidates(pages: ExtractedPage[]): { candidates: FieldCandidate[]; reconciliation: StructuredExtraction["reconciliation"] } {
  const text = pages.map((page) => page.text).join("\n");
  const candidates: FieldCandidate[] = [];
  const pushText = (field_type: FieldCandidate["field_type"], original: string, normalized: string, confidence: number,
    sensitivity: FieldCandidate["sensitivity"] = "standard", flags: FieldCandidate["validation_flags"] = []) => {
    const repeated = candidates.find((item) => item.field_type === field_type && item.original_text === original && item.normalized_value === normalized);
    if (repeated) {
      if (field_type === "invoice_number") {
        repeated.validation_flags = [...new Set([...repeated.validation_flags, "DUPLICATE_INVOICE_IDENTIFIER"] as const)];
        repeated.duplicate_group = normalized.toLocaleUpperCase();
      }
      return;
    }
    candidates.push({ field_type, original_text: original, normalized_value: normalized, confidence, evidence: locateEvidence(pages, original), validation_flags: flags, sensitivity });
  };
  const labeledText: Array<[FieldCandidate["field_type"], RegExp, number, FieldCandidate["sensitivity"]?]> = [
    ["company_name", /(?:company|supplier|vendor)\s*(?:name)?\s*[:#-]\s*([^\n\r]{2,120})/giu, 0.88],
    ["debtor_name", /(?:debtor|customer|bill\s+to)\s*(?:name)?\s*[:#-]\s*([^\n\r]{2,120})/giu, 0.88],
    ["company_identifier", /(?:company|business|registration|ssm)\s*(?:no\.?|number|id)\s*[:#-]?\s*([A-Z0-9()/-]{4,40})/giu, 0.9, "sensitive_identifier"],
    ["debtor_identifier", /(?:debtor|customer)\s*(?:no\.?|number|id)\s*[:#-]?\s*([A-Z0-9()/-]{4,40})/giu, 0.86, "sensitive_identifier"],
    ["invoice_number", /(?:invoice|inv)\s*(?:no\.?|number|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{2,63})/giu, 0.94],
    ["bank_reference", /(?:bank\s+reference|transaction\s*(?:id|reference)|reference)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{3,63})/giu, 0.9, "sensitive_identifier"],
    ["account_reference", /(?:account|a\/c)\s*(?:no\.?|number|reference|ref)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9 /_-]{3,63})/giu, 0.86, "sensitive_identifier"],
    ["contract_term", /(?:contract\s+term|term|duration)\s*[:#-]\s*([^\n\r]{2,120})/giu, 0.78],
  ];
  for (const [type, regex, confidence, sensitivity] of labeledText) {
    for (const match of text.matchAll(regex)) pushText(type, match[0], normalizePartyName(match[1]), confidence, sensitivity);
  }
  const dateRules: Array<[FieldCandidate["field_type"], RegExp, number]> = [
    ["issue_date", /(?:issue|invoice)\s+date\s*[:#-]?\s*(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4})/giu, 0.92],
    ["due_date", /due\s+date\s*[:#-]?\s*(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4})/giu, 0.94],
    ["transaction_date", /(?:transaction|payment|transfer)\s+date\s*[:#-]?\s*(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4})/giu, 0.9],
  ];
  for (const [type, regex, confidence] of dateRules) for (const match of text.matchAll(regex)) {
    const normalized = normalizeDate(match[1]);
    pushText(type, match[0], normalized?.value ?? match[1], normalized ? confidence : 0.2, "standard",
      normalized ? (normalized.ambiguous ? ["AMBIGUOUS_DATE"] : []) : ["IMPOSSIBLE_DATE"]);
  }
  const moneyRules: Array<[FieldCandidate["field_type"], RegExp, number]> = [
    ["tax", /(?:tax|sst|gst|vat)\s*[:#-]?\s*((?:MYR|RM|SGD|S\$|USD|US\$|EUR|€|GBP|£)\s*[-+]?\d[\d., ]*)/giu, 0.9],
    ["credit_note_value", /(?:credit\s+note(?:\s+value)?|credit\s+amount)\s*[:#-]?\s*((?:MYR|RM|SGD|S\$|USD|US\$|EUR|€|GBP|£)\s*[-+]?\d[\d., ]*)/giu, 0.92],
    ["document_total", /(?:grand\s+total|amount\s+due|total)\s*[:#-]?\s*((?:MYR|RM|SGD|S\$|USD|US\$|EUR|€|GBP|£)\s*[-+]?\d[\d., ]*)/giu, 0.94],
    ["amount", /(?:amount|paid|payment)\s*[:#-]?\s*((?:MYR|RM|SGD|S\$|USD|US\$|EUR|€|GBP|£)\s*[-+]?\d[\d., ]*)/giu, 0.88],
    ["line_item_amount", /(?:line\s+item|item)\s*[^\n\r:]{0,80}[:#-]?\s*((?:MYR|RM|SGD|S\$|USD|US\$|EUR|€|GBP|£)\s*[-+]?\d[\d., ]*)/giu, 0.78],
  ];
  for (const [type, regex, confidence] of moneyRules) for (const match of text.matchAll(regex)) {
    const money = parseLocaleMoney(match[1]);
    if (money) candidates.push({ field_type: type, original_text: match[0].trim(), normalized_value: money, confidence,
      evidence: locateEvidence(pages, match[0].trim()), validation_flags: [], sensitivity: "standard" });
    else pushText(type, match[0], match[1], 0.2, "standard", ["MALFORMED_CURRENCY"]);
  }
  const invoiceGroups = new Map<string, FieldCandidate[]>();
  for (const candidate of candidates.filter((item) => item.field_type === "invoice_number")) {
    const key = String(candidate.normalized_value).toLocaleUpperCase();
    invoiceGroups.set(key, [...(invoiceGroups.get(key) ?? []), candidate]);
  }
  for (const [key, group] of invoiceGroups) if (group.length > 1) for (const candidate of group) {
    candidate.validation_flags.push("DUPLICATE_INVOICE_IDENTIFIER"); candidate.duplicate_group = key;
  }
  const lines = candidates.filter((item) => item.field_type === "line_item_amount" && typeof item.normalized_value !== "string");
  const totals = candidates.filter((item) => item.field_type === "document_total" && typeof item.normalized_value !== "string");
  const currency = lines[0] && typeof lines[0].normalized_value !== "string" ? lines[0].normalized_value.currency : null;
  const comparable = Boolean(currency && lines.length && totals.length && lines.every((item) => typeof item.normalized_value !== "string" && item.normalized_value.currency === currency));
  const lineSum = comparable ? lines.reduce((sum, item) => sum + (typeof item.normalized_value === "string" ? 0 : item.normalized_value.minor_units), 0) : null;
  const total = comparable && typeof totals[0].normalized_value !== "string" ? totals[0].normalized_value.minor_units : null;
  const reconciles = lineSum === null || total === null ? null : lineSum === total;
  if (reconciles === false) for (const candidate of [...lines, totals[0]]) candidate.validation_flags.push("TOTAL_DOES_NOT_RECONCILE");
  for (const money of candidates.filter((item) => typeof item.normalized_value !== "string")) {
    const value = money.normalized_value as { currency: string; minor_units: number };
    pushText("currency", money.original_text, value.currency, money.confidence);
  }
  return { candidates, reconciliation: { available: comparable, reconciles, line_item_minor_units: lineSum, total_minor_units: total, currency } };
}

function classify(text: string): { value: ClassifiedDocumentKind; confidence: number } {
  const ranked = classificationRules.map((rule) => ({
    kind: rule.kind,
    matches: rule.patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0),
    total: rule.patterns.length,
  })).sort((left, right) => right.matches - left.matches || left.total - right.total);
  const winner = ranked[0];
  if (!winner || winner.matches === 0) return { value: "unknown_or_other", confidence: 0.25 };
  const runnerUp = ranked[1]?.matches ?? 0;
  const confidence = 0.58 + Math.min(0.3, winner.matches * 0.12) - (runnerUp === winner.matches ? 0.16 : 0);
  return { value: winner.kind, confidence: roundConfidence(confidence) };
}

function parseMinorUnits(recognizedAmount: string): number | null {
  const normalized = recognizedAmount.replace(/[\s,]/gu, "");
  if (!/^\d+(?:\.\d{2})?$/u.test(normalized)) return null;
  const [whole, decimal = "00"] = normalized.split(".");
  try {
    const minor = BigInt(whole) * 100n + BigInt(decimal);
    return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
  } catch {
    return null;
  }
}

function uniqueTextCandidates(matches: Iterable<{ value: string; confidence: number }>, pages: ExtractedPage[]): TextCandidate[] {
  const seen = new Set<string>();
  const output: TextCandidate[] = [];
  for (const match of matches) {
    const key = match.value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ value: match.value, confidence: roundConfidence(match.confidence), evidence: locateEvidence(pages, match.value) });
  }
  return output;
}

function matchValues(text: string, expression: RegExp, confidence: number, group = 1) {
  return [...text.matchAll(expression)]
    .map((match) => match[group]?.trim())
    .filter((value): value is string => Boolean(value))
    .map((value) => ({ value, confidence }));
}

function amountLabel(context: string): AmountCandidate["label"] {
  if (/available\s+balance|closing\s+balance|current\s+balance/iu.test(context)) return "available_balance";
  if (/daily\s+(?:transfer\s+)?limit|transaction\s+limit/iu.test(context)) return "daily_limit";
  if (/fee|charge|commission/iu.test(context)) return "fee";
  if (/total\s+debit/iu.test(context)) return "total_debit";
  if (/amount\s+paid|payment\s+amount/iu.test(context)) return "payment_amount";
  if (/deposit\s+amount|cash\s+deposit/iu.test(context)) return "deposit_amount";
  if (/transfer\s+amount|amount\s+transferred|funds?\s+transfer/iu.test(context)) return "transfer_amount";
  if (/invoice\s+total|total\s+due|amount\s+due/iu.test(context)) return "invoice_total";
  if (/total|amount|paid|transfer/iu.test(context)) return "transaction_amount";
  return "amount";
}

export function buildStructuredExtraction(pages: ExtractedPage[]): StructuredExtraction {
  const text = pages.map((page) => page.text).join("\n\f\n");
  const warnings: string[] = [];
  const documentKind = classify(text);

  const amounts: AmountCandidate[] = [];
  const amountExpression = /\b(MYR|RM|SGD|USD|EUR|GBP)\s*([0-9]+(?:[ ,][0-9]{3})*(?:\.[0-9]{2})?)\b/giu;
  for (const match of text.matchAll(amountExpression)) {
    const currency = match[1].toUpperCase() === "RM" ? "MYR" : match[1].toUpperCase();
    const minor = parseMinorUnits(match[2]);
    if (minor === null) continue;
    const recognized = match[0];
    if (amounts.some((candidate) => candidate.minor_units === minor && candidate.currency === currency)) continue;
    const context = text.slice(Math.max(0, (match.index ?? 0) - 45), (match.index ?? 0) + recognized.length + 45);
    amounts.push({
      minor_units: minor,
      currency,
      label: amountLabel(context),
      confidence: 0.84,
      evidence: locateEvidence(pages, recognized),
      recognized_string: recognized,
    });
  }
  if (amounts.length > extractionConfig.maxAmountCandidates) {
    amounts.length = extractionConfig.maxAmountCandidates;
    warnings.push("TOO_MANY_AMOUNT_CANDIDATES");
  }
  const currencies = new Set(amounts.map((candidate) => candidate.currency));
  if (currencies.size === 0) warnings.push("CURRENCY_NOT_DETECTED");
  if (currencies.size > 1) warnings.push("CONFLICTING_CURRENCIES");
  const amountPages = new Set(amounts.map((candidate) => candidate.evidence.page).filter((value) => value !== null));
  const distinctAmounts = new Set(amounts.map((candidate) => `${candidate.currency}:${candidate.minor_units}`));
  if (amountPages.size > 1 && distinctAmounts.size > 1) warnings.push("MULTIPLE_PAGES_CONFLICTING_VALUES");

  const dateValues = [
    ...matchValues(text, /\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2})\b/gu, 0.82),
    ...matchValues(text, /\b((?:0?[1-9]|[12]\d|3[01])[/-](?:0?[1-9]|1[0-2])[/-](?:20)?\d{2})\b/gu, 0.72),
  ];
  const dates = uniqueTextCandidates(dateValues, pages);
  if (new Set(dates.map((candidate) => candidate.value)).size > 4) warnings.push("MULTIPLE_DATE_CANDIDATES");

  const references = uniqueTextCandidates(matchValues(
    text,
    /(?:transaction\s*(?:id|reference)|reference|ref\.?\s*(?:no\.?|number)?|receipt\s*no\.?)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{4,63})/giu,
    0.86,
  ), pages);
  const banks = uniqueTextCandidates(bankPatterns.flatMap((pattern) => matchValues(text, pattern, 0.9, 0)), pages);
  const senders = uniqueTextCandidates(matchValues(text, /(?:from|sender|payer)\s*[:#-]\s*([^\n\r]{2,100})/giu, 0.72), pages);
  const recipients = uniqueTextCandidates(matchValues(text, /(?:to|recipient|beneficiary)\s*[:#-]\s*([^\n\r]{2,100})/giu, 0.72), pages);
  const statuses = uniqueTextCandidates(matchValues(text, /\b(successful|completed|approved|pending|failed|rejected)\b/giu, 0.82, 0), pages);

  if (documentKind.value === "unknown_or_other") warnings.push("UNKNOWN_DOCUMENT_KIND");
  if (documentKind.confidence < extractionConfig.minimumClassificationConfidence) warnings.push("LOW_CLASSIFICATION_CONFIDENCE");
  if (!text.trim()) warnings.push("NO_READABLE_TEXT");
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const latinLetters = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
  if (letters >= 6 && latinLetters / letters < 0.8) warnings.push("UNSUPPORTED_LANGUAGE_OR_SCRIPT");
  const structuredFields = fieldCandidates(pages);
  if (structuredFields.candidates.some((candidate) => candidate.validation_flags.includes("IMPOSSIBLE_DATE"))) warnings.push("IMPOSSIBLE_DATE");
  if (structuredFields.candidates.some((candidate) => candidate.validation_flags.includes("MALFORMED_CURRENCY"))) warnings.push("MALFORMED_CURRENCY");
  if (structuredFields.reconciliation.reconciles === false) warnings.push("TOTAL_DOES_NOT_RECONCILE");

  return {
    document_kind: documentKind,
    amount_candidates: amounts,
    transaction_date_candidates: dates,
    reference_candidates: references,
    bank_candidates: banks,
    sender_candidates: senders,
    recipient_candidates: recipients,
    status_candidates: statuses,
    field_candidates: structuredFields.candidates,
    reconciliation: structuredFields.reconciliation,
    warnings: [...new Set(warnings)],
    parser_version: EXTRACTION_PARSER_VERSION,
  };
}
