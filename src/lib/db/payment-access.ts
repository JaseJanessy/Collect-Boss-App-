import { getServerClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  type PaymentAccessRequestRow,
  type PaymentAccessRequestInsert,
  type PaymentAccessRequestUpdate,
} from "@/lib/supabase/types";
import { ok, fail, type DbResult } from "./result";
import { mockPaymentRequests } from "@/lib/mock-payment-data";

function mockToRow(r: (typeof mockPaymentRequests)[0]): PaymentAccessRequestRow {
  return {
    id:               r.id,
    case_id:          r.caseId,
    requester_name:   r.debtorName,
    requester_phone:  r.phone,
    otp_verified:     r.otpVerified,
    preferred_method: r.preferredMethod,
    reason:           r.reason,
    status:           r.status,
    access_type:      r.approvalType ?? null,
    approved_at:      r.approvedAt ?? null,
    expires_at:       r.expiresAt ?? null,
    created_at:       new Date().toISOString(),
  };
}

export async function getPaymentAccessRequests(): Promise<DbResult<PaymentAccessRequestRow[]>> {
  if (!isSupabaseConfigured) {
    return ok(mockPaymentRequests.map(mockToRow));
  }

  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("payment_access_requests")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return fail(error.message);
  return ok(data ?? []);
}

export async function getPaymentAccessRequestById(
  id: string
): Promise<DbResult<PaymentAccessRequestRow>> {
  if (!isSupabaseConfigured) {
    const found = mockPaymentRequests.find((r) => r.id === id);
    if (!found) return fail("Request not found");
    return ok(mockToRow(found));
  }

  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("payment_access_requests")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return fail(error.message);
  if (!data)  return fail("Request not found");
  return ok(data);
}

export async function approvePaymentAccess(
  id: string,
  accessType: PaymentAccessRequestRow["access_type"]
): Promise<DbResult<PaymentAccessRequestRow>> {
  if (!isSupabaseConfigured) return fail("Supabase not configured");

  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const expiresAt =
    accessType === "24h"
      ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      : null;

  const patch: PaymentAccessRequestUpdate = {
    status:      "approved",
    access_type: accessType,
    approved_at: new Date().toISOString(),
    expires_at:  expiresAt,
  };

  const { data, error } = await client
    .from("payment_access_requests")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data);
}

export async function rejectPaymentAccess(
  id: string
): Promise<DbResult<PaymentAccessRequestRow>> {
  if (!isSupabaseConfigured) return fail("Supabase not configured");

  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("payment_access_requests")
    .update({ status: "rejected" } satisfies PaymentAccessRequestUpdate)
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data);
}

/**
 * Server-side check: does a valid, non-expired approved request exist for this case?
 * Used by the /pay/[caseId] route before showing account details.
 */
export async function hasValidApproval(caseId: string): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  const client = await getServerClient();
  if (!client) return false;

  const { data } = await client
    .from("payment_access_requests")
    .select("id, expires_at")
    .eq("case_id", caseId)
    .eq("status", "approved")
    .or("expires_at.is.null,expires_at.gt." + new Date().toISOString())
    .limit(1)
    .maybeSingle();

  return !!data;
}
