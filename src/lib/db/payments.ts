import { isSupabaseConfigured } from "@/lib/supabase/client";
import { getServerClient } from "@/lib/supabase/server-client";
import {
  type PaymentRow,
  type PaymentInsert,
  type PaymentUpdate,
  type PaymentMethod,
} from "@/lib/supabase/types";
import { ok, fail, type DbResult } from "./result";
import { mockPaymentRecords } from "@/lib/mock-payment-data";

function mockMethodToDb(m: string): PaymentMethod {
  const map: Record<string, PaymentMethod> = {
    "DuitNow QR":  "duitnow_qr",
    "Bank Transfer": "bank_transfer",
    "Cash":        "cash",
    "Cheque":      "cheque",
    "TNG eWallet": "tng_ewallet",
  };
  return map[m] ?? "bank_transfer";
}

function mockToRow(r: (typeof mockPaymentRecords)[0]): PaymentRow {
  return {
    id:             r.id,
    case_id:        r.caseId,
    currency:       "MYR",
    amount:         r.amount,
    payment_method: mockMethodToDb(r.method),
    reference_no:   r.reference,
    proof_url:      null,
    review_status:  r.proofStatus === "not_uploaded" ? "pending_review" : r.proofStatus,
    reviewed_at:    null,
    reviewed_by:    null,
    notes:          r.notes ?? null,
    financial_event_id: null,
    source_submission_id: null,
    reversed_at: null,
    reversed_by: null,
    reversal_reason: null,
    created_at:     new Date().toISOString(),
  };
}

export async function getPayments(caseId?: string): Promise<DbResult<PaymentRow[]>> {
  if (!isSupabaseConfigured) {
    const records = caseId
      ? mockPaymentRecords.filter((r) => r.caseId === caseId)
      : mockPaymentRecords;
    return ok(records.map(mockToRow));
  }

  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  let query = client
    .from("payments")
    .select("*")
    .order("created_at", { ascending: false });

  if (caseId) query = query.eq("case_id", caseId);

  const { data, error } = await query;
  if (error) return fail(error.message);
  return ok(data ?? []);
}

export async function recordPayment(
  input: PaymentInsert
): Promise<DbResult<PaymentRow>> {
  if (!isSupabaseConfigured) return fail("Supabase not configured");

  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("payments")
    .insert(input)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data);
}

/**
 * Approve a payment (manual review by creditor).
 * This is the ONLY way a payment is marked approved — never automatic.
 */
export async function approvePayment(
  id: string,
  reviewerId: string
): Promise<DbResult<PaymentRow>> {
  if (!isSupabaseConfigured) return fail("Supabase not configured");

  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const patch: PaymentUpdate = {
    review_status: "approved",
    reviewed_at:   new Date().toISOString(),
    reviewed_by:   reviewerId,
  };

  const { data, error } = await client
    .from("payments")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data);
}

export async function rejectPayment(
  id: string,
  reviewerId: string
): Promise<DbResult<PaymentRow>> {
  if (!isSupabaseConfigured) return fail("Supabase not configured");

  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const patch: PaymentUpdate = {
    review_status: "rejected",
    reviewed_at:   new Date().toISOString(),
    reviewed_by:   reviewerId,
  };

  const { data, error } = await client
    .from("payments")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data);
}
