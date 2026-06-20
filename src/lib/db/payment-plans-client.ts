/**
 * Client-side payment plans CRUD.
 * Falls back to in-memory mock store when Supabase is not configured.
 */

import { getBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  type PaymentPlanRow,
  type PaymentPlanInsert,
  type PaymentPlanUpdate,
  type PaymentPlanStatus,
} from "@/lib/supabase/types";
import { ok, fail, type DbResult } from "./result";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate monthly due dates starting from start_date */
export function calculateDueDates(startDate: string, count: number): string[] {
  const dates: string[] = [];
  const start = new Date(startDate + "T00:00:00");
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setMonth(d.getMonth() + i + 1);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

export function calculateInstallment(total: number, count: number): number {
  return Math.ceil((total / count) * 100) / 100; // round up to 2dp
}

export function getNextDueDate(plan: PaymentPlanRow): string | null {
  const today = new Date().toISOString().split("T")[0];
  return plan.due_dates.find((d) => d >= today) ?? null;
}

export function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-MY", {
    day: "numeric", month: "short", year: "numeric",
  });
}

// ─── Mock store ───────────────────────────────────────────────────────────────

const _mockStore: PaymentPlanRow[] = [];

function mockId(): string {
  return `plan-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
}

// ─── getPaymentPlansClient ────────────────────────────────────────────────────

export async function getPaymentPlansClient(
  caseId: string
): Promise<DbResult<PaymentPlanRow[]>> {
  if (!isSupabaseConfigured) {
    return ok(_mockStore.filter((p) => p.case_id === caseId));
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("payment_plans")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });

  if (error) return fail(error.message);
  return ok((data as PaymentPlanRow[]) ?? []);
}

// ─── getActivePlanClient ──────────────────────────────────────────────────────

export async function getActivePlanClient(
  caseId: string
): Promise<PaymentPlanRow | null> {
  if (!isSupabaseConfigured) {
    return _mockStore.find((p) => p.case_id === caseId && p.status === "active") ?? null;
  }

  const client = getBrowserClient();
  if (!client) return null;

  const { data } = await client
    .from("payment_plans")
    .select("*")
    .eq("case_id", caseId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as PaymentPlanRow | null) ?? null;
}

// ─── createPaymentPlanClient ──────────────────────────────────────────────────

export async function createPaymentPlanClient(
  input: PaymentPlanInsert
): Promise<DbResult<PaymentPlanRow>> {
  if (!isSupabaseConfigured) {
    const newRow: PaymentPlanRow = {
      id:                 mockId(),
      case_id:            input.case_id,
      total_amount:       input.total_amount,
      installment_count:  input.installment_count,
      installment_amount: input.installment_amount,
      start_date:         input.start_date,
      due_dates:          input.due_dates,
      status:             input.status ?? "active",
      debtor_confirmed:   input.debtor_confirmed ?? false,
      debtor_name:        input.debtor_name ?? null,
      debtor_phone:       input.debtor_phone ?? null,
      signature_url:      input.signature_url ?? null,
      confirmed_at:       input.confirmed_at ?? null,
      notes:              input.notes ?? null,
      created_at:         new Date().toISOString(),
    };
    _mockStore.unshift(newRow);
    return ok(newRow);
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("payment_plans")
    .insert(input)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data as PaymentPlanRow);
}

// ─── confirmPlanClient ────────────────────────────────────────────────────────
// Debtor confirms the plan — never auto-updates balance

export async function confirmPlanClient(
  id: string,
  debtorName: string,
  debtorPhone: string
): Promise<DbResult<PaymentPlanRow>> {
  const patch: PaymentPlanUpdate = {
    debtor_confirmed: true,
    debtor_name:      debtorName,
    debtor_phone:     debtorPhone || null,
    confirmed_at:     new Date().toISOString(),
  };

  if (!isSupabaseConfigured) {
    const idx = _mockStore.findIndex((p) => p.id === id);
    if (idx === -1) return fail("Plan not found");
    _mockStore[idx] = { ..._mockStore[idx], ...patch };
    return ok(_mockStore[idx]);
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("payment_plans")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data as PaymentPlanRow);
}

// ─── updatePlanStatusClient ───────────────────────────────────────────────────

export async function updatePlanStatusClient(
  id: string,
  status: PaymentPlanStatus
): Promise<DbResult<PaymentPlanRow>> {
  if (!isSupabaseConfigured) {
    const idx = _mockStore.findIndex((p) => p.id === id);
    if (idx === -1) return fail("Plan not found");
    _mockStore[idx] = { ..._mockStore[idx], status };
    return ok(_mockStore[idx]);
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("payment_plans")
    .update({ status } satisfies PaymentPlanUpdate)
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data as PaymentPlanRow);
}

// ─── getPublicPlanClient ──────────────────────────────────────────────────────
// Used by debtor-facing page — only returns safe fields

export async function getPublicPlanClient(
  caseId: string
): Promise<PaymentPlanRow | null> {
  return getActivePlanClient(caseId);
}
