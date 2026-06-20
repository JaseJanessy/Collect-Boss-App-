/**
 * Client-side payments CRUD.
 * Falls back to in-memory mock store when Supabase is not configured.
 *
 * SECURITY: balance is NEVER updated until a payment is explicitly approved.
 */

import { getBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  type PaymentRow,
  type PaymentInsert,
  type PaymentUpdate,
  type PaymentReviewStatus,
  type PaymentMethod,
} from "@/lib/supabase/types";
import { ok, fail, type DbResult } from "./result";
import { recordPaymentClient } from "./cases-client";
import { mockPaymentRecords } from "@/lib/mock-payment-data";

// ─── Constants ────────────────────────────────────────────────────────────────

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  duitnow_qr:    "DuitNow QR",
  bank_transfer: "Bank Transfer",
  cash:          "Cash",
  cheque:        "Cheque",
  tng_ewallet:   "TNG eWallet",
};

export const PAYMENT_METHOD_ICONS: Record<PaymentMethod, string> = {
  duitnow_qr:    "💳",
  bank_transfer: "🏦",
  cash:          "💵",
  cheque:        "📝",
  tng_ewallet:   "📱",
};

export const REVIEW_STATUS_CONFIG: Record<
  PaymentReviewStatus,
  { label: string; color: string; bg: string; border: string; dot: string }
> = {
  pending_review: { label: "Pending Review", color: "text-amber-700",   bg: "bg-amber-50",   border: "border-amber-200",   dot: "bg-amber-400"   },
  approved:       { label: "Approved",       color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", dot: "bg-emerald-500" },
  rejected:       { label: "Rejected",       color: "text-red-600",     bg: "bg-red-50",     border: "border-red-200",     dot: "bg-red-400"     },
  unmatched:      { label: "Unmatched",      color: "text-gray-500",    bg: "bg-gray-50",    border: "border-gray-200",    dot: "bg-gray-400"    },
};

export const PROOF_BUCKET = "payment-proofs";
export const MAX_PROOF_SIZE = 10 * 1024 * 1024; // 10 MB

// ─── Mock store ───────────────────────────────────────────────────────────────

let _mockStore: PaymentRow[] | null = null;

function methodToDb(m: string): PaymentMethod {
  const map: Record<string, PaymentMethod> = {
    "DuitNow QR":  "duitnow_qr",
    "Bank Transfer": "bank_transfer",
    "Cash":        "cash",
    "Cheque":      "cheque",
    "TNG eWallet": "tng_ewallet",
  };
  return map[m] ?? "bank_transfer";
}

function initMockStore(): PaymentRow[] {
  return mockPaymentRecords.map((r) => ({
    id:             r.id,
    case_id:        r.caseId,
    amount:         r.amount,
    payment_method: methodToDb(r.method),
    reference_no:   r.reference ?? null,
    proof_url:      r.proofUploaded ? `mock-proof-${r.id}.jpg` : null,
    review_status:  (r.proofStatus === "not_uploaded" ? "pending_review" : r.proofStatus) as PaymentReviewStatus,
    reviewed_at:    r.proofStatus === "approved" ? new Date().toISOString() : null,
    reviewed_by:    r.proofStatus === "approved" ? "mock-owner-id" : null,
    notes:          r.notes ?? null,
    created_at:     new Date(Date.now() - Math.random() * 86400000 * 3).toISOString(),
  }));
}

function getMockStore(): PaymentRow[] {
  if (!_mockStore) _mockStore = initMockStore();
  return _mockStore;
}

function mockId(): string {
  return `pmt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ─── getPaymentsClient ────────────────────────────────────────────────────────

export async function getPaymentsClient(
  caseId?: string
): Promise<DbResult<PaymentRow[]>> {
  if (!isSupabaseConfigured) {
    const store = getMockStore();
    return ok(caseId ? store.filter((p) => p.case_id === caseId) : [...store]);
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  let query = client
    .from("payments")
    .select("*")
    .order("created_at", { ascending: false });

  if (caseId) query = query.eq("case_id", caseId);

  const { data, error } = await query;
  if (error) return fail(error.message);
  return ok((data as PaymentRow[]) ?? []);
}

// ─── uploadProofFile ──────────────────────────────────────────────────────────

export async function uploadProofFile(
  file: File,
  caseId: string,
  onProgress?: (pct: number) => void
): Promise<string | null> {
  if (!isSupabaseConfigured) {
    onProgress?.(100);
    return `mock-proof-${Date.now()}-${file.name}`;
  }

  const client = getBrowserClient();
  if (!client) return null;

  const ext   = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const path  = `${caseId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

  onProgress?.(20);
  const { error } = await client.storage.from(PROOF_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type,
  });

  if (error) { onProgress?.(0); return null; }
  onProgress?.(100);
  return path;
}

// ─── createPaymentClient ──────────────────────────────────────────────────────
// Always created as pending_review — never auto-approved

export async function createPaymentClient(
  input: Omit<PaymentInsert, "review_status" | "reviewed_at" | "reviewed_by"> & {
    review_status?: PaymentReviewStatus;
  }
): Promise<DbResult<PaymentRow>> {
  const reviewStatus = input.review_status ?? "pending_review";

  if (!isSupabaseConfigured) {
    const newRow: PaymentRow = {
      id:             mockId(),
      case_id:        input.case_id,
      amount:         input.amount,
      payment_method: input.payment_method,
      reference_no:   input.reference_no ?? null,
      proof_url:      input.proof_url ?? null,
      review_status:  reviewStatus,
      reviewed_at:    reviewStatus === "approved" ? new Date().toISOString() : null,
      reviewed_by:    reviewStatus === "approved" ? "mock-owner-id" : null,
      notes:          input.notes ?? null,
      created_at:     new Date().toISOString(),
    };
    getMockStore().unshift(newRow);

    // If creating as approved (creditor direct record), update case immediately
    if (reviewStatus === "approved") {
      await recordPaymentClient(input.case_id, input.amount);
    }

    return ok(newRow);
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("payments")
    .insert({ ...input, review_status: reviewStatus })
    .select()
    .single();

  if (error) return fail(error.message);

  // If creating as approved directly, update case amount_paid
  if (reviewStatus === "approved") {
    await recordPaymentClient(input.case_id, input.amount);
  }

  return ok(data as PaymentRow);
}

// ─── approvePaymentClient ─────────────────────────────────────────────────────
// Approval MUST also update case.amount_paid

export async function approvePaymentClient(
  id: string,
  businessId: string
): Promise<DbResult<PaymentRow>> {
  if (!isSupabaseConfigured) {
    const store = getMockStore();
    const idx   = store.findIndex((p) => p.id === id);
    if (idx === -1) return fail("Payment not found");

    const payment = store[idx];
    store[idx] = {
      ...payment,
      review_status: "approved",
      reviewed_at:   new Date().toISOString(),
      reviewed_by:   "mock-owner-id",
    };

    // Update case.amount_paid
    await recordPaymentClient(payment.case_id, payment.amount);
    return ok(store[idx]);
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  // Fetch current payment to get amount + case_id
  const { data: current, error: fetchErr } = await client
    .from("payments")
    .select("amount, case_id, review_status")
    .eq("id", id)
    .single();

  if (fetchErr || !current) return fail(fetchErr?.message ?? "Payment not found");

  // Don't double-count already approved
  if ((current as PaymentRow).review_status === "approved") {
    return fail("Payment is already approved");
  }

  const patch: PaymentUpdate = {
    review_status: "approved",
    reviewed_at:   new Date().toISOString(),
    reviewed_by:   businessId,
  };

  const { data, error } = await client
    .from("payments")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(error.message);

  // Update case.amount_paid
  await recordPaymentClient(
    (current as { case_id: string }).case_id,
    (current as { amount: number }).amount
  );

  return ok(data as PaymentRow);
}

// ─── rejectPaymentClient ──────────────────────────────────────────────────────

export async function rejectPaymentClient(
  id: string,
  businessId: string
): Promise<DbResult<PaymentRow>> {
  if (!isSupabaseConfigured) {
    const store = getMockStore();
    const idx   = store.findIndex((p) => p.id === id);
    if (idx === -1) return fail("Payment not found");
    store[idx] = { ...store[idx], review_status: "rejected", reviewed_at: new Date().toISOString(), reviewed_by: "mock-owner-id" };
    return ok(store[idx]);
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("payments")
    .update({ review_status: "rejected", reviewed_at: new Date().toISOString(), reviewed_by: businessId } satisfies PaymentUpdate)
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data as PaymentRow);
}

// ─── markUnmatchedPaymentClient ───────────────────────────────────────────────

export async function markUnmatchedPaymentClient(
  id: string,
  businessId: string
): Promise<DbResult<PaymentRow>> {
  if (!isSupabaseConfigured) {
    const store = getMockStore();
    const idx   = store.findIndex((p) => p.id === id);
    if (idx === -1) return fail("Payment not found");
    store[idx] = { ...store[idx], review_status: "unmatched", reviewed_at: new Date().toISOString(), reviewed_by: "mock-owner-id" };
    return ok(store[idx]);
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("payments")
    .update({ review_status: "unmatched", reviewed_at: new Date().toISOString(), reviewed_by: businessId } satisfies PaymentUpdate)
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data as PaymentRow);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function totalApprovedAmount(payments: PaymentRow[]): number {
  return payments
    .filter((p) => p.review_status === "approved")
    .reduce((s, p) => s + p.amount, 0);
}
