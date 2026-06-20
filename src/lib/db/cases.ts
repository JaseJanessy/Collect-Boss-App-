/**
 * Cases data access layer.
 * Falls back to mock data when Supabase env vars are missing.
 */

import { getServerClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { type CaseRow, type CaseInsert, type CaseUpdate } from "@/lib/supabase/types";
import { ok, fail, type DbResult } from "./result";
import {
  mockCases,
  mockCaseActivities,
  mockCaseEvidence,
  mockNextBestActions,
  type DebtorCase,
} from "@/lib/mock-data";

// ─── Adapters: convert mock data ↔ DB row ─────────────────────────────────────

function mockToRow(m: DebtorCase): CaseRow {
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
    status:            mockStatusToDb(m.status),
    next_best_action:  mockNextBestActions[m.id]?.ctaLabel ?? null,
    payment_lock_mode: "approval",
    days_overdue:      m.daysOverdue,
    notes:             m.notes ?? null,
    bank:              m.bank,
    created_at:        new Date().toISOString(),
    updated_at:        new Date().toISOString(),
  };
}

function mockStatusToDb(s: DebtorCase["status"]): CaseRow["status"] {
  const map: Record<DebtorCase["status"], CaseRow["status"]> = {
    "Action Needed":      "action_needed",
    "Payment Promise":    "payment_promise",
    "Partial Paid":       "partial_paid",
    "Paid":               "paid",
    "Overdue":            "overdue",
    "Formal Demand Ready":"formal_demand_ready",
  };
  return map[s];
}

// ─── getCases ─────────────────────────────────────────────────────────────────

export async function getCases(): Promise<DbResult<CaseRow[]>> {
  if (!isSupabaseConfigured) {
    return ok(mockCases.map(mockToRow));
  }
  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("cases")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return fail(error.message);
  return ok(data ?? []);
}

// ─── getCaseById ──────────────────────────────────────────────────────────────

export async function getCaseById(id: string): Promise<DbResult<CaseRow>> {
  if (!isSupabaseConfigured) {
    const found = mockCases.find((c) => c.id === id);
    if (!found) return fail("Case not found");
    return ok(mockToRow(found));
  }
  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("cases")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return fail(error.message);
  if (!data)  return fail("Case not found");
  return ok(data);
}

// ─── createCase ───────────────────────────────────────────────────────────────

export async function createCase(
  input: CaseInsert
): Promise<DbResult<CaseRow>> {
  if (!isSupabaseConfigured) {
    return fail("Supabase not configured — cannot persist case");
  }
  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("cases")
    .insert(input)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data);
}

// ─── updateCase ───────────────────────────────────────────────────────────────

export async function updateCase(
  id: string,
  patch: CaseUpdate
): Promise<DbResult<CaseRow>> {
  if (!isSupabaseConfigured) {
    return fail("Supabase not configured — cannot update case");
  }
  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("cases")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data);
}

// ─── getCaseStats ─────────────────────────────────────────────────────────────

export async function getCaseStats(): Promise<
  DbResult<{
    totalToCollect: number;
    recoveredThisMonth: number;
    followUpToday: number;
    paymentPromises: number;
    totalPromiseValue: number;
  }>
> {
  if (!isSupabaseConfigured) {
    const { mockStats } = await import("@/lib/mock-data");
    return ok(mockStats);
  }
  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const [{ data: cases }, { data: payments }] = await Promise.all([
    client.from("cases").select("status, balance, amount_owed"),
    client
      .from("payments")
      .select("amount, created_at")
      .eq("review_status", "approved")
      .gte(
        "created_at",
        new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
      ),
  ]);

  const totalToCollect = (cases ?? [])
    .filter((c) => c.status !== "paid")
    .reduce((s, c) => s + (c.balance ?? 0), 0);

  const recoveredThisMonth = (payments ?? []).reduce((s, p) => s + p.amount, 0);

  const followUpToday = (cases ?? []).filter(
    (c) => c.status === "overdue" || c.status === "action_needed"
  ).length;

  const promiseCases = (cases ?? []).filter((c) => c.status === "payment_promise");
  const paymentPromises = promiseCases.length;
  const totalPromiseValue = promiseCases.reduce((s, c) => s + (c.balance ?? 0), 0);

  return ok({
    totalToCollect,
    recoveredThisMonth,
    followUpToday,
    paymentPromises,
    totalPromiseValue,
  });
}
