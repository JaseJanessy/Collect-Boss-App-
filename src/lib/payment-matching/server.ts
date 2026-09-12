import "server-only";

import type { DocumentAccess } from "@/lib/document-intake/server";
import type { MatchingThresholds, NormalizedPaymentTransaction, PaymentMatchTarget } from "./engine";
import { defaultMatchingThresholds } from "./engine";
import type { NormalizedPaymentTransactionRow, PaymentMatchingSettingsRow } from "@/lib/supabase/types";

export async function loadMatchingSettings(access: DocumentAccess): Promise<MatchingThresholds> {
  const { data } = await access.service.from("payment_matching_settings").select("high_confidence_threshold,ambiguous_threshold,date_window_days,maximum_candidates")
    .eq("business_id", access.businessId).maybeSingle();
  const row = data as Pick<PaymentMatchingSettingsRow, "high_confidence_threshold" | "ambiguous_threshold" | "date_window_days" | "maximum_candidates"> | null;
  return row ? {
    highConfidence: row.high_confidence_threshold,
    ambiguous: row.ambiguous_threshold,
    dateWindowDays: row.date_window_days,
    maximumCandidates: row.maximum_candidates,
  } : defaultMatchingThresholds;
}

export async function loadNormalizedTransaction(access: DocumentAccess, transactionId: string) {
  const { data, error } = await access.service.from("normalized_payment_transactions").select("*")
    .eq("business_id", access.businessId).eq("id", transactionId).maybeSingle();
  if (error || !data) return null;
  const row = data as NormalizedPaymentTransactionRow;
  const normalized: NormalizedPaymentTransaction = {
    id: row.id, amountMinor: Number(row.amount_minor), currency: row.currency, occurredAt: row.occurred_at,
    reference: row.reference, invoiceNumber: row.invoice_number, partyName: row.party_name,
    accountReference: row.account_reference, phone: row.phone, phoneMatchPermitted: row.phone_match_permitted,
  };
  return { row, normalized };
}

type ObligationProjection = {
  id: string; customer_id: string; account_id: string | null; reference: string;
  issue_date: string | null; due_date: string; outstanding_minor: number; currency: string;
};
type CaseProjection = { id: string; debtor_id: string; account_id: string | null; currency: string; archived_at: string | null };

export async function loadPaymentMatchTargets(access: DocumentAccess): Promise<PaymentMatchTarget[]> {
  const { data: obligations, error: obligationsError } = await access.service.from("obligations")
    .select("id,customer_id,account_id,reference,issue_date,due_date,outstanding_minor,currency")
    .eq("business_id", access.businessId).is("archived_at", null).gt("outstanding_minor", 0)
    .in("status", ["open", "overdue", "partial", "disputed"]);
  if (obligationsError) throw new Error("Unable to load eligible invoices.");
  const obligationRows = (obligations ?? []) as ObligationProjection[];
  const obligationIds = obligationRows.map((row) => row.id);
  const { data: links, error: linksError } = obligationIds.length
    ? await access.service.from("recovery_case_obligations").select("case_id,obligation_id").eq("business_id", access.businessId).in("obligation_id", obligationIds)
    : { data: [], error: null };
  if (linksError) throw new Error("Unable to load invoice case links.");
  const caseByObligation = new Map((links ?? []).map((row) => [String(row.obligation_id), String(row.case_id)]));
  const caseIds = [...new Set([...caseByObligation.values()])];
  const { data: cases, error: casesError } = caseIds.length
    ? await access.service.from("cases").select("id,debtor_id,account_id,currency,archived_at").eq("business_id", access.businessId).in("id", caseIds).is("archived_at", null)
    : { data: [], error: null };
  if (casesError) throw new Error("Unable to load eligible cases.");
  const caseRows = (cases ?? []) as CaseProjection[];
  const customerIds = [...new Set(caseRows.map((row) => row.debtor_id))];
  const accountIds = [...new Set(caseRows.map((row) => row.account_id).filter((id): id is string => Boolean(id)))];
  const [debtorsResult, accountsResult, paymentsResult] = await Promise.all([
    customerIds.length ? access.service.from("debtors").select("id,individual_name,business_name,phone").eq("business_id", access.businessId).in("id", customerIds) : Promise.resolve({ data: [], error: null }),
    accountIds.length ? access.service.from("customer_accounts").select("id,account_number").eq("business_id", access.businessId).in("id", accountIds) : Promise.resolve({ data: [], error: null }),
    caseIds.length ? access.service.from("payments").select("id,case_id,amount_minor,currency,reference_no,review_status").in("case_id", caseIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (debtorsResult.error || accountsResult.error || paymentsResult.error) throw new Error("Unable to load candidate matching signals.");
  const debtors = new Map((debtorsResult.data ?? []).map((row) => [String(row.id), row]));
  const accounts = new Map((accountsResult.data ?? []).map((row) => [String(row.id), row]));
  const payments = paymentsResult.data ?? [];
  const casesById = new Map(caseRows.map((row) => [row.id, row]));
  return obligationRows.flatMap((obligation) => {
    const caseId = caseByObligation.get(obligation.id);
    const caseRow = caseId ? casesById.get(caseId) : null;
    if (!caseId || !caseRow || caseRow.currency !== obligation.currency) return [];
    const debtor = debtors.get(obligation.customer_id);
    if (!debtor) return [];
    const casePayments = payments.filter((payment) => payment.case_id === caseId);
    return [{
      key: `${caseId}:${obligation.id}`,
      customerId: obligation.customer_id,
      customerName: String(debtor.business_name ?? debtor.individual_name ?? ""),
      customerPhone: debtor.phone ? String(debtor.phone) : null,
      accountId: obligation.account_id,
      accountReference: obligation.account_id ? String(accounts.get(obligation.account_id)?.account_number ?? "") || null : null,
      obligationId: obligation.id,
      invoiceNumber: obligation.reference,
      issueDate: obligation.issue_date,
      dueDate: obligation.due_date,
      outstandingMinor: Number(obligation.outstanding_minor),
      currency: obligation.currency,
      caseId,
      priorApprovedPaymentCount: casePayments.filter((payment) => payment.review_status === "approved").length,
      existingPayments: casePayments.map((payment) => ({
        id: String(payment.id), amountMinor: Number(payment.amount_minor), currency: String(payment.currency),
        reference: payment.reference_no ? String(payment.reference_no) : null, reviewStatus: String(payment.review_status),
      })),
    }];
  });
}

