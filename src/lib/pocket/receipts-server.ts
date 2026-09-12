import "server-only";

import type { DocumentAccess, IntakeEvidenceRecord } from "@/lib/document-intake/server";
import { buildReviewWorkspace, type ReviewExtraction } from "@/lib/document-intake/review";
import { normalizePocketEmail, normalizePocketPhone } from "./ledger";

type Row = Record<string, unknown>;

const text = (value: unknown) => typeof value === "string" ? value : null;
const number = (value: unknown) => typeof value === "number" ? value : value == null ? null : Number(value);
const normalizedName = (value: string | null) => value?.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase() ?? "";
const normalizedIdentifier = (value: string | null) => value?.normalize("NFKC").replace(/[^a-z0-9]/giu, "").toUpperCase() ?? "";

function extractionView(row: Row): ReviewExtraction {
  return {
    id: String(row.id), evidenceId: String(row.evidence_id), extractionVersion: number(row.extraction_version),
    documentVersion: number(row.document_version), status: String(row.status),
    documentKind: text(row.document_classification), classificationConfidence: number(row.confidence),
    structuredResult: row.structured_result && typeof row.structured_result === "object" ? row.structured_result as Record<string, unknown> : null,
    parserVersion: String(row.parser_version ?? ""), provider: String(row.provider ?? ""),
    providerModel: text(row.provider_model), providerVersion: text(row.provider_version),
    extractionMethod: text(row.extraction_method), completedAt: text(row.completed_at),
  };
}

function confirmationView(row: Row | null) {
  if (!row) return null;
  return {
    id: String(row.id), reviewStatus: String(row.review_status), extractionId: text(row.extraction_id),
    documentKind: text(row.confirmed_document_kind), amountMinor: number(row.chosen_amount_minor),
    currency: text(row.currency), transactionDatetime: text(row.document_datetime), timezone: text(row.confirmed_timezone),
    reference: text(row.reference), bank: text(row.bank), payerHint: text(row.sender) ?? text(row.recipient),
    notes: text(row.notes), reviewedAt: text(row.confirmed_at),
  };
}

function jsonScalar(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

export async function loadPocketReceiptWorkspace(access: DocumentAccess, intakeId: string) {
  const intakeResult = await access.service.from("document_intakes").select("id,status,intended_workflow,version,created_at,updated_at")
    .eq("id", intakeId).eq("business_id", access.businessId).eq("intended_workflow", "payment_evidence").is("deleted_at", null).maybeSingle();
  if (intakeResult.error || !intakeResult.data) return null;

  const [evidenceResult, extractionResult, confirmationResult, linkResult, businessResult] = await Promise.all([
    access.service.from("evidence_files")
      .select("id,intake_id,file_name,file_size_bytes,evidence_type,evidence_version,is_current,scan_status,processing_status,duplicate_match_status,page_count,image_width,image_height,evidence_source,quality_warnings,magic_mime_type,uploaded_at")
      .eq("business_id", access.businessId).eq("intake_id", intakeId).eq("kind", "original").is("soft_deleted_at", null)
      .order("evidence_version", { ascending: false }),
    access.service.from("document_intake_extractions")
      .select("id,evidence_id,extraction_version,document_version,status,document_classification,structured_result,confidence,provider,provider_model,provider_version,parser_version,extraction_method,error_code,completed_at,created_at")
      .eq("business_id", access.businessId).eq("intake_id", intakeId).order("created_at", { ascending: false }),
    access.service.from("document_intake_confirmations")
      .select("id,review_status,extraction_id,confirmed_document_kind,chosen_amount_minor,currency,document_datetime,confirmed_timezone,reference,bank,sender,recipient,notes,confirmed_at")
      .eq("business_id", access.businessId).eq("intake_id", intakeId).order("confirmation_version", { ascending: false }).limit(1).maybeSingle(),
    access.service.from("pocket_receipt_payment_links").select("allocation_id,receipt_id,debt_id,customer_id,created_at")
      .eq("business_id", access.businessId).eq("intake_id", intakeId).maybeSingle(),
    access.service.from("businesses").select("default_currency,timezone").eq("id", access.businessId).single(),
  ]);
  if (evidenceResult.error || extractionResult.error || confirmationResult.error || linkResult.error || businessResult.error || !businessResult.data) throw new Error("RECEIPT_WORKSPACE_FAILED");

  const evidence = (evidenceResult.data ?? []) as unknown as IntakeEvidenceRecord[];
  const currentEvidence = evidence.find((item) => item.is_current) ?? null;
  const extractions = ((extractionResult.data ?? []) as unknown as Row[]).map(extractionView);
  const latestExtraction = extractions.find((item) => item.evidenceId === currentEvidence?.id) ?? null;
  const reviewWorkspace = buildReviewWorkspace(latestExtraction);
  const latestReview = confirmationView(confirmationResult.data as unknown as Row | null);
  let probableDuplicate = false;
  if (latestReview?.amountMinor && latestReview.currency && latestReview.transactionDatetime) {
    const reviewedDate = latestReview.transactionDatetime.slice(0, 10);
    const similar = await access.service.from("payment_receipts").select("received_at")
      .eq("business_id", access.businessId).eq("amount_minor", latestReview.amountMinor).eq("currency", latestReview.currency)
      .order("received_at", { ascending: false }).limit(50);
    if (similar.error) throw new Error("RECEIPT_DUPLICATE_CHECK_FAILED");
    probableDuplicate = (similar.data ?? []).some((item) => item.received_at.slice(0, 10) === reviewedDate);
  }

  const candidateRows = latestExtraction ? await access.service.from("document_extraction_candidates")
    .select("field_type,normalized_value,confidence").eq("business_id", access.businessId).eq("extraction_id", latestExtraction.id)
    .in("field_type", ["company_identifier", "debtor_identifier"]) : { data: [], error: null };
  if (candidateRows.error) throw new Error("RECEIPT_CANDIDATES_FAILED");
  const strongIdentifiers = new Set((candidateRows.data ?? []).map((item) => normalizedIdentifier(jsonScalar(item.normalized_value))).filter(Boolean));
  const payerHints = [...reviewWorkspace.senderCandidates, ...reviewWorkspace.recipientCandidates].map((item) => item.value);
  const referenceHints = reviewWorkspace.referenceCandidates.map((item) => item.value).filter(Boolean);

  const [customersResult, debtsResult] = await Promise.all([
    access.service.from("debtors").select("id,individual_name,business_name,registration_no,email,phone,normalized_email,normalized_phone")
      .eq("business_id", access.businessId).is("archived_at", null).is("merged_into_id", null).order("created_at"),
    access.service.from("obligations").select("id,customer_id,pocket_description,reference,outstanding_minor,currency,status,pocket_due_date")
      .eq("business_id", access.businessId).eq("origin_product_type", "pocket").is("archived_at", null).gt("outstanding_minor", 0).order("created_at"),
  ]);
  if (customersResult.error || debtsResult.error) throw new Error("RECEIPT_CUSTOMERS_FAILED");

  const historyCustomerIds = new Set<string>();
  let duplicateReference = false;
  if (referenceHints.length) {
    const receipts = await access.service.from("payment_receipts").select("id,reference").eq("business_id", access.businessId).in("reference", referenceHints.slice(0, 20));
    if (!receipts.error && (receipts.data ?? []).length) {
      duplicateReference = true;
      const allocations = await access.service.from("payment_allocations").select("obligation_id").eq("business_id", access.businessId)
        .in("receipt_id", (receipts.data ?? []).map((item) => item.id)).eq("event_type", "allocation");
      const obligationIds = (allocations.data ?? []).flatMap((item) => item.obligation_id ? [item.obligation_id] : []);
      if (obligationIds.length) {
        const historyDebts = await access.service.from("obligations").select("customer_id").eq("business_id", access.businessId).in("id", obligationIds);
        for (const item of historyDebts.data ?? []) historyCustomerIds.add(item.customer_id);
      }
    }
  }

  const customerMatches = (customersResult.data ?? []).flatMap((customer) => {
    const displayName = customer.individual_name ?? customer.business_name ?? "Customer";
    const reasons: string[] = [];
    let confidence = 0;
    let strongIdentifierMatch = false;
    if (strongIdentifiers.has(normalizedIdentifier(customer.registration_no))) {
      reasons.push("Registration identifier matches the receipt"); confidence = 0.98; strongIdentifierMatch = true;
    }
    const email = normalizePocketEmail(customer.email);
    const phone = normalizePocketPhone(customer.phone);
    if (payerHints.some((hint) => email && normalizePocketEmail(hint) === email)) {
      reasons.push("Email matches the receipt"); confidence = Math.max(confidence, 0.94); strongIdentifierMatch = true;
    }
    if (payerHints.some((hint) => phone && phone.length >= 7 && normalizePocketPhone(hint) === phone)) {
      reasons.push("Phone matches the receipt"); confidence = Math.max(confidence, 0.9); strongIdentifierMatch = true;
    }
    if (historyCustomerIds.has(customer.id)) {
      reasons.push("Reference matches this customer's payment history"); confidence = Math.max(confidence, 0.9); strongIdentifierMatch = true;
    }
    if (!strongIdentifierMatch && payerHints.some((hint) => normalizedName(hint) === normalizedName(displayName))) {
      reasons.push("Name looks similar; choose the customer manually"); confidence = 0.45;
    }
    return reasons.length ? [{ customerId: customer.id, displayName, confidence, strongIdentifierMatch, reasons }] : [];
  }).sort((left, right) => right.confidence - left.confidence || left.displayName.localeCompare(right.displayName));

  return {
    intake: intakeResult.data,
    evidence: currentEvidence ? {
      id: currentEvidence.id, fileName: currentEvidence.file_name, bytes: currentEvidence.file_size_bytes,
      evidenceSource: currentEvidence.evidence_source, scanStatus: currentEvidence.scan_status,
      processingStatus: currentEvidence.processing_status, duplicateWarning: currentEvidence.duplicate_match_status === "exact_hash_warning",
      qualityWarnings: currentEvidence.quality_warnings ?? [], hasSafePreview: currentEvidence.magic_mime_type?.startsWith("image/") ?? false,
    } : null,
    extraction: latestExtraction ? { ...latestExtraction, structuredResult: undefined } : null,
    workspace: reviewWorkspace,
    latestReview,
    payment: linkResult.data ?? null,
    business: { defaultCurrency: businessResult.data.default_currency, timezone: businessResult.data.timezone },
    customers: (customersResult.data ?? []).map((item) => ({ id: item.id, displayName: item.individual_name ?? item.business_name ?? "Customer" })),
    debts: (debtsResult.data ?? []).map((item) => ({ id: item.id, customerId: item.customer_id, description: item.pocket_description ?? item.reference, remainingMinor: Number(item.outstanding_minor), currency: item.currency, status: item.status, dueDate: item.pocket_due_date })),
    customerMatches,
    suggestedCustomer: customerMatches.find((item) => item.strongIdentifierMatch) ?? customerMatches[0] ?? null,
    duplicateWarnings: [
      ...(currentEvidence?.duplicate_match_status === "exact_hash_warning" ? ["This exact file was uploaded before."] : []),
      ...(duplicateReference ? ["The extracted reference appears in existing payment history."] : []),
      ...(probableDuplicate ? ["A payment with the same amount and date already exists. Compare it before continuing."] : []),
      ...(reviewWorkspace.amountCandidates.length > 1 ? ["Multiple monetary values were found. Confirm the payment amount."] : []),
    ],
  };
}
