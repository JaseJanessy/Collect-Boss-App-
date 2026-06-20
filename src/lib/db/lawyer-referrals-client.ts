/**
 * Client-side lawyer referrals CRUD.
 * Falls back to in-memory mock store when Supabase is not configured.
 */

import { getBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  type LawyerReferralRow,
  type LawyerReferralInsert,
  type LawyerReferralUpdate,
  type ReferralStatus,
} from "@/lib/supabase/types";
import { ok, fail, type DbResult } from "./result";

// ─── Mock store ───────────────────────────────────────────────────────────────

const _mockStore: LawyerReferralRow[] = [];

function mockId(): string {
  return `ref-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
}

// ─── getReferralsByCaseClient ─────────────────────────────────────────────────

export async function getReferralsByCaseClient(
  caseId: string
): Promise<DbResult<LawyerReferralRow[]>> {
  if (!isSupabaseConfigured) {
    return ok(_mockStore.filter((r) => r.case_id === caseId));
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("lawyer_referrals")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });

  if (error) return fail(error.message);
  return ok((data as LawyerReferralRow[]) ?? []);
}

// ─── createReferralClient ─────────────────────────────────────────────────────

export async function createReferralClient(
  input: LawyerReferralInsert
): Promise<DbResult<LawyerReferralRow>> {
  if (!isSupabaseConfigured) {
    const now = new Date().toISOString();
    const newRow: LawyerReferralRow = {
      id:                       mockId(),
      case_id:                  input.case_id,
      business_id:              input.business_id,
      referral_status:          input.referral_status ?? "submitted",
      partner_id:               input.partner_id ?? null,
      partner_name:             input.partner_name ?? null,
      partner_firm:             input.partner_firm ?? null,
      preferred_contact_method: input.preferred_contact_method ?? "whatsapp",
      case_summary:             input.case_summary ?? null,
      evidence_pack_id:         input.evidence_pack_id ?? null,
      formal_demand_id:         input.formal_demand_id ?? null,
      notes:                    input.notes ?? null,
      created_at:               now,
      updated_at:               now,
    };
    _mockStore.unshift(newRow);
    return ok(newRow);
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("lawyer_referrals")
    .insert({ ...input, updated_at: new Date().toISOString() })
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data as LawyerReferralRow);
}

// ─── updateReferralStatusClient ───────────────────────────────────────────────

export async function updateReferralStatusClient(
  id: string,
  status: ReferralStatus
): Promise<DbResult<LawyerReferralRow>> {
  const patch: LawyerReferralUpdate = {
    referral_status: status,
    updated_at:      new Date().toISOString(),
  };

  if (!isSupabaseConfigured) {
    const idx = _mockStore.findIndex((r) => r.id === id);
    if (idx === -1) return fail("Referral not found");
    _mockStore[idx] = { ..._mockStore[idx], ...patch };
    return ok(_mockStore[idx]);
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("lawyer_referrals")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data as LawyerReferralRow);
}
