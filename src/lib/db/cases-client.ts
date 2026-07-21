/**
 * Client-side cases CRUD.
 * Uses getBrowserClient() — safe to call from "use client" components.
 * Falls back to in-memory mock store when Supabase is not configured.
 */

import { isSupabaseConfigured } from "@/lib/supabase/client";
import { type CaseRow } from "@/lib/supabase/types";
import { ok, fail, type DbResult } from "./result";
import { type CreateCaseInput, parseAmount } from "@/lib/validations/case";
import { mockCases, type DebtorCase } from "@/lib/mock-data";

// ─── In-memory mock store (seeded from mock-data, persists for the session) ───

let _mockStore: CaseRow[] | null = null;

function getMockStore(): CaseRow[] {
  if (_mockStore) return _mockStore;
  _mockStore = mockCases.map(mockDebtorToRow);
  return _mockStore;
}

function mockDebtorToRow(m: DebtorCase): CaseRow {
  const statusMap: Record<DebtorCase["status"], CaseRow["status"]> = {
    "Action Needed":       "action_needed",
    "Payment Promise":     "payment_promise",
    "Partial Paid":        "partial_paid",
    "Paid":                "paid",
    "Overdue":             "overdue",
    "Formal Demand Ready": "formal_demand_ready",
  };
  return {
    id:                m.id,
    business_id:       "mock-business-id",
    debtor_id:         null,
    debtor_type:       m.companyRegNo ? "business" : "individual",
    debtor_name:       m.debtorName,
    debtor_phone:      m.phone,
    debtor_email:      null,
    debtor_company:    m.debtorName,
    debtor_reg_no:     m.companyRegNo,
    debtor_location:   m.location,
    amount_owed:       m.originalAmount,
    amount_paid:       m.amountPaid,
    balance:           m.amountDue,
    original_principal_minor: Math.round(m.originalAmount * 100),
    contractual_due_minor:    Math.round(m.originalAmount * 100),
    approved_payment_minor:   Math.round(m.amountPaid * 100),
    outstanding_minor:        Math.round(m.amountDue * 100),
    overpayment_minor:        0,
    financial_version:        1,
    due_date:          m.dueDate,
    invoice_no:        m.invoiceNo,
    status:            statusMap[m.status],
    promise_due_date:  null,
    closed_at:         null,
    closed_by:         null,
    close_reason:      null,
    archived_at:       null,
    archived_by:       null,
    archive_reason:    null,
    status_version:    1,
    next_best_action:  null,
    payment_lock_mode: "approval",
    receiving_account_id: null,
    days_overdue:      m.daysOverdue,
    notes:             m.notes ?? null,
    bank:              m.bank,
    created_at:        new Date(Date.now() - Math.random() * 1e10).toISOString(),
    updated_at:        new Date().toISOString(),
  };
}

function generateCaseId(): string {
  const year = new Date().getFullYear();
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `CB-${year}-${random}`;
}

// ─── getCasesClient ───────────────────────────────────────────────────────────

export interface CaseListPage {
  cases: CaseRow[];
  page: number;
  perPage: number;
  total: number;
}

export interface CaseListOptions {
  page?: number;
  perPage?: number;
  query?: string;
  status?: CaseRow["status"];
}

export async function getCasesClient(
  { page = 1, perPage = 50, query = "", status }: CaseListOptions = {},
): Promise<DbResult<CaseListPage>> {
  if (!isSupabaseConfigured) {
    const normalizedQuery = query.trim().toLowerCase();
    const cases = getMockStore().filter((caseData) => {
      const matchesQuery = !normalizedQuery || [caseData.id, caseData.debtor_name, caseData.debtor_company ?? ""]
        .some((value) => value.toLowerCase().includes(normalizedQuery));
      return matchesQuery && (!status || caseData.status === status);
    });
    return ok({ cases: cases.slice((page - 1) * perPage, page * perPage), page, perPage, total: cases.length });
  }

  const searchParams = new URLSearchParams({ page: String(page), perPage: String(perPage) });
  if (query.trim()) searchParams.set("query", query.trim());
  if (status) searchParams.set("status", status);
  const response = await fetch(`/api/cases?${searchParams.toString()}`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as Partial<CaseListPage> & { error?: string };
  if (!response.ok) return fail(apiError(response.status, payload.error, "Failed to load cases."));
  if (!payload.cases || typeof payload.total !== "number") return fail("Invalid case list response.");
  return ok({
    cases: payload.cases,
    page: typeof payload.page === "number" ? payload.page : page,
    perPage: typeof payload.perPage === "number" ? payload.perPage : perPage,
    total: payload.total,
  });
}

// ─── getCaseByIdClient ────────────────────────────────────────────────────────

export async function getCaseByIdClient(
  id: string
): Promise<DbResult<CaseRow>> {
  if (!isSupabaseConfigured) {
    const found = getMockStore().find((c) => c.id === id);
    if (!found) return fail("Case not found");
    return ok(found);
  }

  const response = await fetch(`/api/cases/${encodeURIComponent(id)}`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as { case?: CaseRow; error?: string };
  if (!response.ok) return fail(apiError(response.status, payload.error, "Failed to load case."));
  if (!payload.case) return fail("Invalid case response.");
  return ok(payload.case);
}

// ─── createCaseClient ─────────────────────────────────────────────────────────

export async function createCaseClient(
  input: CreateCaseInput,
  businessId: string
): Promise<DbResult<CaseRow>> {
  const amountOwed = parseAmount(input.amount_owed);

  if (!isSupabaseConfigured) {
    // Mock: add to in-memory store
    const newCase: CaseRow = {
      id:                generateCaseId(),
      business_id:       businessId,
      debtor_id:         null,
      debtor_type:       input.debtor_type,
      debtor_name:       input.debtor_name,
      debtor_phone:      input.debtor_phone || null,
      debtor_email:      input.debtor_email || null,
      debtor_company:    input.debtor_company || null,
      debtor_reg_no:     input.debtor_reg_no || null,
      debtor_location:   input.debtor_location || null,
      amount_owed:       amountOwed,
      amount_paid:       0,
      balance:           amountOwed,
      original_principal_minor: Math.round(amountOwed * 100),
      contractual_due_minor:    Math.round(amountOwed * 100),
      approved_payment_minor:   0,
      outstanding_minor:        Math.round(amountOwed * 100),
      overpayment_minor:        0,
      financial_version:        0,
      due_date:          input.due_date,
      invoice_no:        input.invoice_no || null,
      status:            "action_needed",
      promise_due_date:  null,
      closed_at:         null,
      closed_by:         null,
      close_reason:      null,
      archived_at:       null,
      archived_by:       null,
      archive_reason:    null,
      status_version:    1,
      next_best_action:  "Send a friendly reminder",
      payment_lock_mode: input.payment_lock_mode ?? "approval",
      receiving_account_id: null,
      days_overdue:      0,
      notes:             input.notes || null,
      bank:              null,
      created_at:        new Date().toISOString(),
      updated_at:        new Date().toISOString(),
    };
    getMockStore().unshift(newCase); // add to front of list
    return ok(newCase);
  }

  const response = await fetch("/api/cases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({})) as {
    case?: CaseRow;
    error?: string;
    duplicates?: unknown;
  };
  if (!response.ok) {
    const duplicateError = response.status === 409
      ? "Possible duplicate debtor. Review the suggested match before creating this case."
      : payload.error ?? "Failed to create case";
    return fail(duplicateError);
  }
  if (!payload.case) return fail("Failed to create case");
  return ok(payload.case);
}

// ─── updateCaseStatusClient ───────────────────────────────────────────────────

export async function updateCaseStatusClient(
  id: string,
  status: CaseRow["status"],
  options: { reason?: string; promiseDueDate?: string; expectedVersion?: number } = {},
): Promise<DbResult<CaseRow>> {
  if (!isSupabaseConfigured) {
    const store = getMockStore();
    const idx   = store.findIndex((c) => c.id === id);
    if (idx === -1) return fail("Case not found");
    store[idx] = { ...store[idx], status, promise_due_date: options.promiseDueDate ?? null, status_version: store[idx].status_version + 1, updated_at: new Date().toISOString() };
    return ok(store[idx]);
  }

  return patchCaseClient(id, { action: "status", status, reason: options.reason, promise_due_date: options.promiseDueDate, expected_version: options.expectedVersion });
}

// ─── updateNextActionClient ───────────────────────────────────────────────────

export async function updateNextActionClient(
  id: string,
  nextAction: string
): Promise<DbResult<CaseRow>> {
  if (!isSupabaseConfigured) {
    const store = getMockStore();
    const idx   = store.findIndex((c) => c.id === id);
    if (idx === -1) return fail("Case not found");
    store[idx] = {
      ...store[idx],
      next_best_action: nextAction || null,
      updated_at:       new Date().toISOString(),
    };
    return ok(store[idx]);
  }

  return patchCaseClient(id, { action: "next_action", next_best_action: nextAction });
}

// ─── updateCaseLockModeClient ─────────────────────────────────────────────────

export async function updateCaseLockModeClient(
  id: string,
  lockMode: CaseRow["payment_lock_mode"]
): Promise<DbResult<CaseRow>> {
  if (!isSupabaseConfigured) {
    const store = getMockStore();
    const idx   = store.findIndex((c) => c.id === id);
    if (idx === -1) return fail("Case not found");
    store[idx] = {
      ...store[idx],
      payment_lock_mode: lockMode,
      updated_at:        new Date().toISOString(),
    };
    return ok(store[idx]);
  }

  return patchCaseClient(id, { action: "payment_lock_mode", payment_lock_mode: lockMode });
}

// ─── recordPaymentClient ──────────────────────────────────────────────────────
// Adds to amount_paid, recalculates balance, updates status if fully paid.

export async function recordPaymentClient(
  id: string,
  additionalAmount: string
): Promise<DbResult<CaseRow>> {
  if (!isSupabaseConfigured) {
    const store = getMockStore();
    const idx   = store.findIndex((c) => c.id === id);
    if (idx === -1) return fail("Case not found");

    const numericAmount = Number(additionalAmount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return fail("Invalid payment amount");
    const existing  = store[idx];
    const newPaid   = existing.amount_paid + numericAmount;
    const newBalance = Math.max(0, existing.amount_owed - newPaid);
    const newStatus: CaseRow["status"] = newBalance === 0
      ? "paid"
      : newPaid > 0
      ? "partial_paid"
      : existing.status;

    store[idx] = {
      ...existing,
      amount_paid:  newPaid,
      balance:      newBalance,
      status:       newStatus,
      updated_at:   new Date().toISOString(),
    };
    return ok(store[idx]);
  }

  return patchCaseClient(id, { action: "record_payment", amount: additionalAmount });
}

type CasePatch =
  | { action: "status"; status: CaseRow["status"]; reason?: string; promise_due_date?: string; expected_version?: number }
  | { action: "archive"; reason?: string; expected_version?: number }
  | { action: "next_action"; next_best_action: string }
  | { action: "payment_lock_mode"; payment_lock_mode: CaseRow["payment_lock_mode"] }
  | { action: "record_payment"; amount: string };

async function patchCaseClient(id: string, body: CasePatch): Promise<DbResult<CaseRow>> {
  const response = await fetch(`/api/cases/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as { case?: CaseRow; error?: string };
  if (!response.ok) return fail(apiError(response.status, payload.error, "Failed to update case."));
  if (!payload.case) return fail("Invalid case update response.");
  return ok(payload.case);
}

function apiError(status: number, message: string | undefined, fallback: string) {
  if (status === 401) return "Your session has expired. Sign in again.";
  if (status === 404) return "Case not found.";
  return message ?? fallback;
}
