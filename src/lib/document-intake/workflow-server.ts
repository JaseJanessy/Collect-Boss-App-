import "server-only";

import type { DocumentAccess } from "./server";
import { findTransactionDuplicates, rankProfileMatches, type DuplicateFingerprint, type ProfileIdentity, type ProfileMatchSource, type TransactionWorkflowDraft } from "./workflow";

type WorkflowDraftRow = { intake_id: string; version: number; step: string; draft_data: TransactionWorkflowDraft; updated_at: string };

async function allDebtors(access: DocumentAccess) {
  const rows: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await access.service.from("debtors").select("id,individual_name,business_name,registration_no,email,phone")
      .eq("business_id", access.businessId).is("archived_at", null).range(from, from + 999);
    if (error) throw new Error("Unable to check existing profiles.");
    rows.push(...((data ?? []) as unknown as Array<Record<string, unknown>>));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

export async function loadProfileMatches(access: DocumentAccess, draft: TransactionWorkflowDraft | null) {
  if (!draft) return [];
  const profile = draft.profileDecision?.kind === "new" ? draft.profileDecision.profile : null;
  const identity: ProfileIdentity = {
    name: profile?.name ?? draft.sender ?? draft.recipient, registrationNo: profile?.registrationNo,
    email: profile?.email, phone: profile?.phone, externalProvider: draft.externalProvider,
    externalCustomerId: draft.externalCustomerId,
  };
  const debtors = await allDebtors(access);
  const mappings = new Map<string, Array<{ provider: string; externalCustomerId: string }>>();
  if (identity.externalProvider && identity.externalCustomerId) {
    const { data } = await access.service.from("accounting_external_mappings")
      .select("provider,external_entity_id,collectboss_entity_id").eq("business_id", access.businessId)
      .eq("entity_type", "contact").eq("collectboss_entity_type", "debtor")
      .eq("provider", identity.externalProvider).eq("external_entity_id", identity.externalCustomerId);
    for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
      const id = String(row.collectboss_entity_id ?? "");
      mappings.set(id, [...(mappings.get(id) ?? []), { provider: String(row.provider), externalCustomerId: String(row.external_entity_id) }]);
    }
  }
  const sources: ProfileMatchSource[] = debtors.map((row) => ({
    id: String(row.id), name: String(row.business_name ?? row.individual_name ?? ""),
    registrationNo: row.registration_no ? String(row.registration_no) : null,
    email: row.email ? String(row.email) : null, phone: row.phone ? String(row.phone) : null,
    externalMappings: mappings.get(String(row.id)) ?? [],
  }));
  return rankProfileMatches(identity, sources);
}

function normalizedReference(value?: string | null) {
  return value?.normalize("NFKC").replace(/[^a-z0-9]/giu, "").toUpperCase() || null;
}

export async function loadDuplicateMatches(access: DocumentAccess, intakeId: string, draft: TransactionWorkflowDraft | null) {
  if (!draft) return [];
  const { data: current } = await access.service.from("evidence_files").select("id,content_sha256,evidence_type")
    .eq("business_id", access.businessId).eq("intake_id", intakeId).eq("is_current", true).eq("is_original", true).is("soft_deleted_at", null).maybeSingle();
  const input: DuplicateFingerprint = {
    key: `intake:${intakeId}`, evidenceSha256: current?.content_sha256 ?? null,
    normalizedReference: normalizedReference(draft.reference), externalTransactionId: draft.externalTransactionId ?? null,
    amountMinor: draft.amountMinor ?? null, currency: draft.currency ?? null,
    transactionDate: draft.transactionDate?.slice(0, 10) ?? null,
    partyHint: (draft.sender ?? draft.recipient)?.normalize("NFKC").trim().toLocaleLowerCase() ?? null,
    documentKind: current?.evidence_type ?? null,
  };
  const candidates: DuplicateFingerprint[] = [];
  if (input.evidenceSha256) {
    const { data } = await access.service.from("evidence_files").select("id,content_sha256,evidence_type")
      .eq("business_id", access.businessId).eq("content_sha256", input.evidenceSha256).neq("id", current?.id ?? "")
      .is("soft_deleted_at", null).limit(100);
    for (const row of data ?? []) candidates.push({ key: `evidence:${row.id}`, evidenceSha256: row.content_sha256, documentKind: row.evidence_type });
  }
  if (input.normalizedReference || input.amountMinor) {
    const caseIds: string[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: obligations, error } = await access.service.from("obligations")
        .select("id,reference,original_amount_minor,currency,issue_date,obligation_type")
        .eq("business_id", access.businessId).is("archived_at", null).range(from, from + 999);
      if (error) throw new Error("Unable to check existing obligations.");
      for (const row of obligations ?? []) candidates.push({
        key: `obligation:${row.id}`, normalizedReference: normalizedReference(row.reference), amountMinor: Number(row.original_amount_minor),
        currency: row.currency, transactionDate: row.issue_date, documentKind: row.obligation_type,
      });
      if ((obligations ?? []).length < 1000) break;
    }
    for (let from = 0; ; from += 1000) {
      const { data: cases, error } = await access.service.from("cases").select("id")
        .eq("business_id", access.businessId).is("archived_at", null).range(from, from + 999);
      if (error) throw new Error("Unable to check existing cases.");
      caseIds.push(...(cases ?? []).map((row) => row.id));
      if ((cases ?? []).length < 1000) break;
    }
    for (let index = 0; index < caseIds.length; index += 200) {
      for (let from = 0; ; from += 1000) {
        const { data: payments, error } = await access.service.from("payments")
          .select("id,reference_no,amount_minor,currency,created_at").in("case_id", caseIds.slice(index, index + 200)).range(from, from + 999);
        if (error) throw new Error("Unable to check existing payments.");
        for (const row of payments ?? []) candidates.push({
          key: `payment:${row.id}`, normalizedReference: normalizedReference(row.reference_no), amountMinor: Number(row.amount_minor),
          currency: row.currency, transactionDate: row.created_at.slice(0, 10), documentKind: "payment_receipt",
        });
        if ((payments ?? []).length < 1000) break;
      }
    }
  }
  return findTransactionDuplicates(input, candidates);
}

export async function loadWorkflow(access: DocumentAccess, intakeId: string) {
  const [{ data: row, error }, { data: outcome }] = await Promise.all([
    access.service.from("document_intake_workflow_drafts").select("intake_id,version,step,draft_data,updated_at")
      .eq("business_id", access.businessId).eq("intake_id", intakeId).maybeSingle(),
    access.service.from("document_intake_outcomes").select("route,customer_id,account_id,obligation_id,payment_id,original_payment_id,case_id,result,created_at")
      .eq("business_id", access.businessId).eq("intake_id", intakeId).maybeSingle(),
  ]);
  if (error) throw new Error("Unable to load the transaction workflow.");
  const workflow = row as unknown as WorkflowDraftRow | null;
  const draft = workflow?.draft_data ?? null;
  const [profileMatches, duplicateMatches] = await Promise.all([loadProfileMatches(access, draft), loadDuplicateMatches(access, intakeId, draft)]);
  const customerId = draft?.profileDecision?.kind === "existing" ? draft.profileDecision.customerId : null;
  let relatedRecords = { accounts: [] as Record<string, unknown>[], obligations: [] as Record<string, unknown>[], cases: [] as Record<string, unknown>[], payments: [] as Record<string, unknown>[] };
  if (customerId) {
    const [accountsResult, obligationsResult, casesResult] = await Promise.all([
      access.service.from("customer_accounts").select("id,display_name,currency").eq("business_id", access.businessId).eq("customer_id", customerId).is("archived_at", null),
      access.service.from("obligations").select("id,reference,currency,outstanding_minor,due_date").eq("business_id", access.businessId).eq("customer_id", customerId).is("archived_at", null),
      access.service.from("cases").select("id,invoice_no,currency,outstanding_minor").eq("business_id", access.businessId).eq("debtor_id", customerId).is("archived_at", null),
    ]);
    if (accountsResult.error || obligationsResult.error || casesResult.error) throw new Error("Unable to load linked transaction records.");
    const caseIds = (casesResult.data ?? []).map((item) => item.id);
    const paymentRows: Record<string, unknown>[] = [];
    for (let index = 0; index < caseIds.length; index += 200) {
      const { data, error: paymentError } = await access.service.from("payments")
        .select("id,case_id,amount_minor,currency,reference_no,review_status").in("case_id", caseIds.slice(index, index + 200));
      if (paymentError) throw new Error("Unable to load linked payments.");
      paymentRows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
    }
    relatedRecords = {
      accounts: (accountsResult.data ?? []) as unknown as Record<string, unknown>[],
      obligations: (obligationsResult.data ?? []) as unknown as Record<string, unknown>[],
      cases: (casesResult.data ?? []) as unknown as Record<string, unknown>[], payments: paymentRows,
    };
  }
  return { workflow: workflow ? { version: workflow.version, step: workflow.step, data: draft, updatedAt: workflow.updated_at } : null, profileMatches, duplicateMatches, relatedRecords, outcome: outcome ?? null };
}
