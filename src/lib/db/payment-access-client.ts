/**
 * Client-side payment access request CRUD.
 * Falls back to in-memory mock store when Supabase is not configured.
 */

import { getBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  type PaymentAccessRequestRow,
  type PaymentAccessRequestInsert,
  type PaymentAccessRequestUpdate,
  type AccessRequestStatus,
  type AccessType,
} from "@/lib/supabase/types";
import { ok, fail, type DbResult } from "./result";
import { mockPaymentRequests } from "@/lib/mock-payment-data";

// ─── Mock store ───────────────────────────────────────────────────────────────

let _mockStore: PaymentAccessRequestRow[] | null = null;

function initMockStore(): PaymentAccessRequestRow[] {
  return mockPaymentRequests.map((r) => ({
    id:               r.id,
    case_id:          r.caseId,
    requester_name:   r.debtorName,
    requester_phone:  r.phone,
    otp_verified:     r.otpVerified,
    preferred_method: r.preferredMethod ?? null,
    reason:           r.reason ?? null,
    status:           r.status as AccessRequestStatus,
    access_type:      (r.approvalType ?? null) as AccessType | null,
    approved_at:      r.approvedAt ?? null,
    expires_at:       r.expiresAt ?? null,
    created_at:       new Date(Date.now() - Math.random() * 86400000 * 3).toISOString(),
  }));
}

function getMockStore(): PaymentAccessRequestRow[] {
  if (!_mockStore) _mockStore = initMockStore();
  return _mockStore;
}

function mockId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ─── getPaymentAccessRequestsClient ──────────────────────────────────────────

export async function getPaymentAccessRequestsClient(): Promise<
  DbResult<PaymentAccessRequestRow[]>
> {
  if (!isSupabaseConfigured) {
    return ok([...getMockStore()]);
  }
  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("payment_access_requests")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return fail(error.message);
  return ok((data as PaymentAccessRequestRow[]) ?? []);
}

// ─── getRequestsByCase ────────────────────────────────────────────────────────

export async function getRequestsByCaseClient(
  caseId: string
): Promise<DbResult<PaymentAccessRequestRow[]>> {
  if (!isSupabaseConfigured) {
    return ok(getMockStore().filter((r) => r.case_id === caseId));
  }
  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("payment_access_requests")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });

  if (error) return fail(error.message);
  return ok((data as PaymentAccessRequestRow[]) ?? []);
}

// ─── getActiveApprovalForCase ─────────────────────────────────────────────────
// Returns the first valid (approved, not expired) request for a case.

export async function getActiveApprovalForCaseClient(
  caseId: string
): Promise<PaymentAccessRequestRow | null> {
  if (!isSupabaseConfigured) {
    const now = new Date();
    return (
      getMockStore().find(
        (r) =>
          r.case_id === caseId &&
          r.status === "approved" &&
          (r.expires_at === null || new Date(r.expires_at) > now)
      ) ?? null
    );
  }

  const client = getBrowserClient();
  if (!client) return null;

  const { data } = await client
    .from("payment_access_requests")
    .select("*")
    .eq("case_id", caseId)
    .eq("status", "approved")
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as PaymentAccessRequestRow | null) ?? null;
}

// ─── createPaymentAccessRequestClient ────────────────────────────────────────

export async function createPaymentAccessRequestClient(
  input: PaymentAccessRequestInsert
): Promise<DbResult<PaymentAccessRequestRow>> {
  if (!isSupabaseConfigured) {
    const newRow: PaymentAccessRequestRow = {
      id:               mockId(),
      case_id:          input.case_id,
      requester_name:   input.requester_name,
      requester_phone:  input.requester_phone,
      otp_verified:     input.otp_verified ?? false,
      preferred_method: input.preferred_method ?? null,
      reason:           input.reason ?? null,
      status:           "pending",
      access_type:      null,
      approved_at:      null,
      expires_at:       null,
      created_at:       new Date().toISOString(),
    };
    getMockStore().unshift(newRow);
    return ok(newRow);
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("payment_access_requests")
    .insert(input)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data as PaymentAccessRequestRow);
}

// ─── approvePaymentAccessClient ──────────────────────────────────────────────

export async function approvePaymentAccessClient(
  id: string,
  accessType: AccessType
): Promise<DbResult<PaymentAccessRequestRow>> {
  const now       = new Date().toISOString();
  const expiresAt =
    accessType === "24h"
      ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      : null;

  if (!isSupabaseConfigured) {
    const store = getMockStore();
    const idx   = store.findIndex((r) => r.id === id);
    if (idx === -1) return fail("Request not found");
    store[idx] = {
      ...store[idx],
      status:      "approved",
      access_type: accessType,
      approved_at: now,
      expires_at:  expiresAt,
    };
    return ok(store[idx]);
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const patch: PaymentAccessRequestUpdate = {
    status:      "approved",
    access_type: accessType,
    approved_at: now,
    expires_at:  expiresAt,
  };

  const { data, error } = await client
    .from("payment_access_requests")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data as PaymentAccessRequestRow);
}

// ─── rejectPaymentAccessClient ────────────────────────────────────────────────

export async function rejectPaymentAccessClient(
  id: string
): Promise<DbResult<PaymentAccessRequestRow>> {
  if (!isSupabaseConfigured) {
    const store = getMockStore();
    const idx   = store.findIndex((r) => r.id === id);
    if (idx === -1) return fail("Request not found");
    store[idx] = { ...store[idx], status: "rejected" };
    return ok(store[idx]);
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("payment_access_requests")
    .update({ status: "rejected" } satisfies PaymentAccessRequestUpdate)
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data as PaymentAccessRequestRow);
}

// ─── markSentManuallyClient ───────────────────────────────────────────────────

export async function markSentManuallyClient(
  id: string
): Promise<DbResult<PaymentAccessRequestRow>> {
  if (!isSupabaseConfigured) {
    const store = getMockStore();
    const idx   = store.findIndex((r) => r.id === id);
    if (idx === -1) return fail("Request not found");
    store[idx] = {
      ...store[idx],
      status:      "sent_manually",
      access_type: "manual",
      approved_at: new Date().toISOString(),
    };
    return ok(store[idx]);
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const patch: PaymentAccessRequestUpdate = {
    status:      "sent_manually",
    access_type: "manual",
    approved_at: new Date().toISOString(),
  };

  const { data, error } = await client
    .from("payment_access_requests")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data as PaymentAccessRequestRow);
}

// ─── getRequestByIdClient ─────────────────────────────────────────────────────

export async function getRequestByIdClient(
  id: string
): Promise<DbResult<PaymentAccessRequestRow>> {
  if (!isSupabaseConfigured) {
    const found = getMockStore().find((r) => r.id === id);
    if (!found) return fail("Request not found");
    return ok(found);
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("payment_access_requests")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return fail(error.message);
  if (!data)  return fail("Request not found");
  return ok(data as PaymentAccessRequestRow);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function isRequestExpired(row: PaymentAccessRequestRow): boolean {
  if (row.status !== "approved") return false;
  if (!row.expires_at) return false;
  return new Date(row.expires_at) <= new Date();
}

export function timeUntilExpiry(expiresAt: string): string {
  const ms   = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const h    = Math.floor(ms / 3600000);
  const m    = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m remaining`;
  return `${m}m remaining`;
}
