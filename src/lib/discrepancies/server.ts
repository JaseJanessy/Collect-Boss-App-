import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/client";
import { detectDiscrepancies, type DiscrepancyInput, type DiscrepancySourceRef } from "./engine";

export const DISCREPANCY_DETECTOR_VERSION = "p19-v1";

type Row = Record<string, unknown>;
const text = (value: unknown) => value == null ? "" : String(value);
const bigint = (value: unknown) => BigInt(text(value) || "0");
const ref = (table: string, id: unknown, label: string, field?: string, value?: unknown): DiscrepancySourceRef => ({
  table, id: text(id), label, field, value: value == null ? undefined : text(value),
});

function failed(results: readonly { error: { message?: string } | null }[]) {
  const error = results.find((result) => result.error)?.error;
  if (error) throw new Error(error.message ?? "A discrepancy source could not be loaded.");
}

export async function loadDiscrepancyInput(client: AppSupabaseClient, businessId: string, caseId: string): Promise<DiscrepancyInput> {
  const [caseResult, balanceResult, linksResult, proofsResult, disputesResult, paymentsResult, outcomesResult, adjustmentsResult] = await Promise.all([
    client.from("cases").select("id,business_id,debtor_id,currency,outstanding_minor,debt_truth_version,updated_at").eq("id", caseId).eq("business_id", businessId).maybeSingle(),
    client.from("debt_balance_versions").select("id,version,confirmed_outstanding_minor,disputed_amount_minor,currency,calculated_at").eq("case_id", caseId).eq("business_id", businessId).order("version", { ascending: false }).limit(1).maybeSingle(),
    client.from("recovery_case_obligations").select("obligation_id").eq("case_id", caseId).eq("business_id", businessId),
    client.from("public_payment_submissions").select("id,amount,amount_minor,currency,status,created_at").eq("case_id", caseId).eq("business_id", businessId),
    client.from("disputes").select("id,category,disputed_amount_minor,status,submitted_at").eq("case_id", caseId).eq("business_id", businessId).eq("category", "already_paid"),
    client.from("payments").select("id,amount_minor,currency,review_status,created_at").eq("case_id", caseId),
    client.from("document_intake_outcomes").select("id,intake_id,case_id").eq("case_id", caseId).eq("business_id", businessId),
    client.from("financial_adjustments").select("id,amount_minor,approval_status,financial_event_id,reference").eq("case_id", caseId).eq("business_id", businessId).eq("adjustment_type", "credit_note").eq("direction", "credit"),
  ]);
  failed([caseResult, balanceResult, linksResult, proofsResult, disputesResult, paymentsResult, outcomesResult, adjustmentsResult]);
  const caseRow = caseResult.data as Row | null;
  const balanceRow = balanceResult.data as Row | null;
  if (!caseRow) throw new Error("Case not found.");
  if (!balanceRow) throw new Error("Reconcile the canonical ledger before scanning discrepancies.");
  const currency = text(balanceRow.currency || caseRow.currency || "MYR").toUpperCase();
  const obligationIds = (linksResult.data as Row[] ?? []).map((row) => text(row.obligation_id)).filter(Boolean);
  const outcomeRows = outcomesResult.data as Row[] ?? [];
  const intakeIds = outcomeRows.map((row) => text(row.intake_id)).filter(Boolean);

  const [obligationsResult, candidatesResult, confirmationsResult] = await Promise.all([
    obligationIds.length ? client.from("obligations").select("id,customer_id,reference,original_amount_minor,contractual_due_minor,currency,issue_date,updated_at").eq("business_id", businessId).in("id", obligationIds) : Promise.resolve({ data: [], error: null }),
    client.from("payment_match_candidates").select("transaction_id").eq("business_id", businessId).eq("case_id", caseId),
    intakeIds.length ? client.from("document_intake_confirmations").select("id,intake_id,confirmed_document_kind,chosen_amount_minor,currency,document_kind_confidence,evidence_citations,confirmed_at").eq("business_id", businessId).eq("review_status", "confirmed").in("intake_id", intakeIds) : Promise.resolve({ data: [], error: null }),
  ]);
  failed([obligationsResult, candidatesResult, confirmationsResult]);
  const obligations = obligationsResult.data as Row[] ?? [];
  const transactionIds = [...new Set((candidatesResult.data as Row[] ?? []).map((row) => text(row.transaction_id)).filter(Boolean))];
  const proofIds = (proofsResult.data as Row[] ?? []).map((row) => text(row.id)).filter(Boolean);
  const transactionSelect = "id,source_system,source_record_id,amount_minor,currency,reference,occurred_at,fingerprint_hash,duplicate_of_transaction_id,existing_payment_id,payment_submission_id";
  const [transactionsResult, proofTransactionsResult, mappingsResult] = await Promise.all([
    transactionIds.length ? client.from("normalized_payment_transactions").select(transactionSelect).eq("business_id", businessId).in("id", transactionIds) : Promise.resolve({ data: [], error: null }),
    proofIds.length ? client.from("normalized_payment_transactions").select(transactionSelect).eq("business_id", businessId).in("payment_submission_id", proofIds) : Promise.resolve({ data: [], error: null }),
    obligationIds.length ? client.from("accounting_external_mappings").select("id,provider,entity_type,external_entity_id,collectboss_entity_id,metadata").eq("business_id", businessId).eq("entity_type", "invoice").in("collectboss_entity_id", obligationIds) : Promise.resolve({ data: [], error: null }),
  ]);
  failed([transactionsResult, proofTransactionsResult, mappingsResult]);
  const transactionRows = [...new Map([...(transactionsResult.data as Row[] ?? []), ...(proofTransactionsResult.data as Row[] ?? [])].map((row) => [text(row.id), row])).values()];
  const proofTransactions = new Map(transactionRows.filter((row) => row.payment_submission_id).map((row) => [text(row.payment_submission_id), text(row.id)]));
  const paymentRows = paymentsResult.data as Row[] ?? [];
  const obligationById = new Map(obligations.map((row) => [text(row.id), row]));

  return {
    caseId, now: new Date().toISOString(), invoices: obligations.map((row) => ({
      id: text(row.id), reference: text(row.reference), amountMinor: bigint(row.original_amount_minor), currency: text(row.currency),
      customerId: text(row.customer_id), issueDate: row.issue_date ? text(row.issue_date) : null,
      source: ref("obligations", row.id, `Invoice ${text(row.reference)}`, "original_amount_minor", row.original_amount_minor),
    })),
    transactions: transactionRows.map((row) => ({
      id: text(row.id), sourceSystem: text(row.source_system), sourceRecordId: text(row.source_record_id),
      amountMinor: bigint(row.amount_minor), currency: text(row.currency), reference: row.reference ? text(row.reference) : null,
      occurredAt: row.occurred_at ? text(row.occurred_at) : null, fingerprint: row.fingerprint_hash ? text(row.fingerprint_hash) : null,
      duplicateOfId: row.duplicate_of_transaction_id ? text(row.duplicate_of_transaction_id) : null,
      existingPaymentId: row.existing_payment_id ? text(row.existing_payment_id) : null,
      paymentSubmissionId: row.payment_submission_id ? text(row.payment_submission_id) : null,
      source: ref("normalized_payment_transactions", row.id, `Transaction ${text(row.source_record_id)}`, "amount_minor", row.amount_minor),
    })),
    creditNotes: (adjustmentsResult.data as Row[] ?? []).filter((row) => text(row.approval_status) === "approved").map((row) => ({
      id: text(row.id), amountMinor: bigint(row.amount_minor), appliedMinor: row.financial_event_id ? bigint(row.amount_minor) : 0n,
      currency, source: ref("financial_adjustments", row.id, `Credit note ${text(row.reference) || text(row.id)}`, "amount_minor", row.amount_minor),
    })),
    canonicalBalance: {
      amountMinor: bigint(balanceRow.confirmed_outstanding_minor) + bigint(balanceRow.disputed_amount_minor), currency, version: Number(balanceRow.version),
      recordedAt: text(balanceRow.calculated_at), source: ref("debt_balance_versions", balanceRow.id, "Canonical ledger balance", "confirmed_outstanding_minor", balanceRow.confirmed_outstanding_minor),
    },
    storedBalance: {
      amountMinor: bigint(caseRow.outstanding_minor), currency, version: Number(caseRow.debt_truth_version), recordedAt: caseRow.updated_at ? text(caseRow.updated_at) : null,
      source: ref("cases", caseRow.id, "Case balance projection", "outstanding_minor", caseRow.outstanding_minor),
    },
    proofs: (proofsResult.data as Row[] ?? []).map((row) => ({
      id: text(row.id), amountMinor: bigint(row.amount_minor ?? Math.round(Number(row.amount) * 100)), currency: text(row.currency || currency),
      recordedAt: text(row.created_at), matchedTransactionId: proofTransactions.get(text(row.id)) ?? null, status: text(row.status),
      source: ref("public_payment_submissions", row.id, "Debtor payment proof", "amount_minor", row.amount_minor),
    })),
    accounting: (mappingsResult.data as Row[] ?? []).flatMap((row) => {
      const obligation = obligationById.get(text(row.collectboss_entity_id));
      const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Row : {};
      if (!obligation || metadata.last_total_minor == null) return [];
      return [{
        id: text(row.id), entityType: text(row.entity_type), externalAmountMinor: bigint(metadata.last_total_minor),
        localAmountMinor: bigint(obligation.original_amount_minor), currency: text(obligation.currency),
        externalSource: ref("accounting_external_mappings", row.id, `${text(row.provider)} invoice ${text(row.external_entity_id)}`, "metadata.last_total_minor", metadata.last_total_minor),
        localSource: ref("obligations", obligation.id, `CollectBoss invoice ${text(obligation.reference)}`, "original_amount_minor", obligation.original_amount_minor),
      }];
    }),
    documents: (confirmationsResult.data as Row[] ?? []).filter((row) => ["contract", "invoice"].includes(text(row.confirmed_document_kind)) && row.chosen_amount_minor != null).map((row) => ({
      id: text(row.id), kind: text(row.confirmed_document_kind) as "contract" | "invoice", amountMinor: bigint(row.chosen_amount_minor),
      currency: text(row.currency || currency), confidence: Number(row.document_kind_confidence ?? 1), recordedAt: text(row.confirmed_at),
      source: { ...ref("document_intake_confirmations", row.id, `${text(row.confirmed_document_kind)} confirmed amount`, "chosen_amount_minor", row.chosen_amount_minor), evidenceId: text(row.intake_id) },
    })),
    paidClaims: (disputesResult.data as Row[] ?? []).map((row) => {
      const amount = bigint(row.disputed_amount_minor);
      const match = paymentRows.find((payment) => text(payment.review_status) === "approved" && bigint(payment.amount_minor) === amount);
      return {
        id: text(row.id), amountMinor: amount, currency, status: text(row.status), matchedPaymentId: match ? text(match.id) : null,
        recordedAt: text(row.submitted_at), source: ref("disputes", row.id, "Debtor already-paid claim", "disputed_amount_minor", row.disputed_amount_minor),
      };
    }),
  };
}

export function serializeDetectedFindings(input: DiscrepancyInput) {
  return detectDiscrepancies(input).map((item) => ({
    finding_key: item.findingKey, category: item.code, state_class: item.state, severity: item.severity,
    confidence: item.confidence, confidence_score: item.confidenceScore, impacted_amount_minor: item.impactedAmountMinor.toString(),
    currency: item.currency.toUpperCase(), title: item.title, explanation: item.explanation,
    conflicting_values: item.conflictingValues, source_references: item.sources, recommended_action: item.recommendedAction,
    source_fingerprint: item.sourceFingerprint,
  }));
}
