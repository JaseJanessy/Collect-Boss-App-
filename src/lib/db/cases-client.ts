/**
 * Client-side cases CRUD.
 * Uses getBrowserClient() — safe to call from "use client" components.
 * Falls back to in-memory mock store when Supabase is not configured.
 */

import { getBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { type CaseRow, type CaseUpdate } from "@/lib/supabase/types";
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
    debtor_name:       m.debtorName,
    debtor_phone:      m.phone,
    debtor_email:      null,
    debtor_company:    m.debtorName,
    debtor_reg_no:     m.companyRegNo,
    debtor_location:   m.location,
    amount_owed:       m.originalAmount,
    amount_paid:       m.amountPaid,
    balance:           m.amountDue,
    due_date:          m.dueDate,
    invoice_no:        m.invoiceNo,
    status:            statusMap[m.status],
    next_best_action:  null,
    payment_lock_mode: "approval",
    days_overdue:      m.daysOverdue,
    notes:             m.notes ?? null,
    bank:              m.bank,
    created_at:        new Date(Date.now() - Math.random() * 1e10).toISOString(),
    updated_at:        new Date().toISOString(),
  };
}

function generateMockId(): string {
  const year = new Date().getFullYear();
  const seq  = Math.floor(Math.random() * 9000 + 1000);
  return `CB-${year}-${seq}`;
}

// ─── getCasesClient ───────────────────────────────────────────────────────────

export async function getCasesClient(): Promise<DbResult<CaseRow[]>> {
  if (!isSupabaseConfigured) {
    return ok(getMockStore());
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("cases")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return fail(error.message);
  return ok((data as CaseRow[]) ?? []);
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

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("cases")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return fail(error.message);
  if (!data)  return fail("Case not found");
  return ok(data as CaseRow);
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
      id:                generateMockId(),
      business_id:       businessId,
      debtor_name:       input.debtor_name,
      debtor_phone:      input.debtor_phone || null,
      debtor_email:      input.debtor_email || null,
      debtor_company:    input.debtor_company || null,
      debtor_reg_no:     null,
      debtor_location:   input.debtor_location || null,
      amount_owed:       amountOwed,
      amount_paid:       0,
      balance:           amountOwed,
      due_date:          input.due_date,
      invoice_no:        input.invoice_no || null,
      status:            "action_needed",
      next_best_action:  "Send a friendly reminder",
      payment_lock_mode: input.payment_lock_mode ?? "approval",
      days_overdue:      0,
      notes:             input.notes || null,
      bank:              null,
      created_at:        new Date().toISOString(),
      updated_at:        new Date().toISOString(),
    };
    getMockStore().unshift(newCase); // add to front of list
    return ok(newCase);
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("cases")
    .insert({
      business_id:       businessId,
      debtor_name:       input.debtor_name,
      debtor_phone:      input.debtor_phone || null,
      debtor_email:      input.debtor_email || null,
      debtor_company:    input.debtor_company || null,
      debtor_location:   input.debtor_location || null,
      amount_owed:       amountOwed,
      amount_paid:       0,
      due_date:          input.due_date,
      invoice_no:        input.invoice_no || null,
      status:            "action_needed" as const,
      payment_lock_mode: input.payment_lock_mode ?? "approval",
      notes:             input.notes || null,
    })
    .select()
    .single();

  if (error) return fail(error.message);
  if (!data)  return fail("Failed to create case");
  return ok(data as CaseRow);
}

// ─── updateCaseStatusClient ───────────────────────────────────────────────────

export async function updateCaseStatusClient(
  id: string,
  status: CaseRow["status"]
): Promise<DbResult<CaseRow>> {
  if (!isSupabaseConfigured) {
    const store = getMockStore();
    const idx   = store.findIndex((c) => c.id === id);
    if (idx === -1) return fail("Case not found");
    store[idx] = { ...store[idx], status, updated_at: new Date().toISOString() };
    return ok(store[idx]);
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const patch: CaseUpdate = { status };
  const { data, error } = await client
    .from("cases")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data as CaseRow);
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

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const patch: CaseUpdate = { next_best_action: nextAction || null };
  const { data, error } = await client
    .from("cases")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data as CaseRow);
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

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const patch: CaseUpdate = { payment_lock_mode: lockMode };
  const { data, error } = await client
    .from("cases")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data as CaseRow);
}

// ─── recordPaymentClient ──────────────────────────────────────────────────────
// Adds to amount_paid, recalculates balance, updates status if fully paid.

export async function recordPaymentClient(
  id: string,
  additionalAmount: number
): Promise<DbResult<CaseRow>> {
  if (!isSupabaseConfigured) {
    const store = getMockStore();
    const idx   = store.findIndex((c) => c.id === id);
    if (idx === -1) return fail("Case not found");

    const existing  = store[idx];
    const newPaid   = existing.amount_paid + additionalAmount;
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

  // For Supabase: read current values then update
  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  // Get current
  const { data: current, error: fetchErr } = await client
    .from("cases")
    .select("amount_paid, amount_owed")
    .eq("id", id)
    .single();

  if (fetchErr || !current) return fail(fetchErr?.message ?? "Case not found");

  const newPaid    = (current as { amount_paid: number; amount_owed: number }).amount_paid + additionalAmount;
  const amountOwed = (current as { amount_paid: number; amount_owed: number }).amount_owed;
  const newBalance = Math.max(0, amountOwed - newPaid);
  const newStatus: CaseRow["status"] = newBalance === 0
    ? "paid"
    : newPaid > 0
    ? "partial_paid"
    : "overdue";

  const patch: CaseUpdate = {
    amount_paid: newPaid,
    status:      newStatus,
  };

  const { data, error } = await client
    .from("cases")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data as CaseRow);
}
