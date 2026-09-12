/**
 * Client-side receiving accounts CRUD.
 * Falls back to in-memory mock store when Supabase is not configured.
 */

import { getBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  type ReceivingAccountRow,
  type ReceivingAccountInsert,
  type ReceivingAccountUpdate,
} from "@/lib/supabase/types";
import { ok, fail, type DbResult } from "./result";
import { mockReceivingAccounts } from "@/lib/mock-payment-data";
import { maskAccountIdentifier } from "@/lib/receiving-accounts/security";
import { isServiceRequestError, requestJson } from "@/lib/data/http-service";

async function apiMutation(path: string, method: "POST" | "PATCH" | "DELETE", body: unknown): Promise<DbResult<ReceivingAccountRow>> {
  try {
    const payload = await requestJson<{ account?: ReceivingAccountRow }>(
      path,
      { method, body: JSON.stringify(body), cache: "no-store" },
      "Unable to save receiving account.",
    );
    return payload.account ? ok(payload.account) : fail("Unable to save receiving account.");
  } catch (error) {
    if (isServiceRequestError(error)) return fail(error.message);
    throw error;
  }
}

// ─── Mock store ───────────────────────────────────────────────────────────────

let _mockStore: ReceivingAccountRow[] | null = null;

function mockToRow(
  a: (typeof mockReceivingAccounts)[0]
): ReceivingAccountRow {
  return {
    id:                   a.id,
    business_id:          "mock-business-id",
    currency:             "MYR",
    business_entity_id:   null,
    bank_name:            a.bankName,
    account_holder_name:  a.accountHolder,
    account_number:       a.accountNumber,
    duitnow_id:           a.duitnowId ?? null,
    duitnow_qr_url:       null,
    include_in_reminders: a.includeInReminder,
    is_primary:           a.isPrimary,
    created_at:           new Date().toISOString(),
    updated_at:           new Date().toISOString(),
    version:              1,
    business_entity:      a.accountHolder,
    payment_method:       "bank_transfer",
    masked_display:       maskAccountIdentifier(a.accountNumber),
    qr_object_path:       null,
    is_active:            true,
    verification_status:  "unverified",
    created_by:           null,
    updated_by:           null,
    approved_by:          null,
    approved_at:          null,
  };
}

function getMockStore(): ReceivingAccountRow[] {
  if (!_mockStore) _mockStore = mockReceivingAccounts.map(mockToRow);
  return _mockStore;
}

// ─── getReceivingAccountsClient ───────────────────────────────────────────────

export async function getReceivingAccountsClient(
  _businessId?: string
): Promise<DbResult<ReceivingAccountRow[]>> {
  if (!isSupabaseConfigured) {
    return ok([...getMockStore()]);
  }
  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("receiving_accounts")
    .select("*")
    .order("is_primary", { ascending: false });

  if (error) return fail(error.message);
  return ok((data as ReceivingAccountRow[]) ?? []);
}

// ─── getPrimaryAccountClient ──────────────────────────────────────────────────

export async function getPrimaryAccountClient(currency?: string): Promise<ReceivingAccountRow | null> {
  if (!isSupabaseConfigured) {
    return getMockStore().find((a) => a.is_primary && a.include_in_reminders && (!currency || a.currency === currency)) ?? null;
  }
  const client = getBrowserClient();
  if (!client) return null;

  let query = client
    .from("receiving_accounts")
    .select("*")
    .eq("is_primary", true)
    .eq("include_in_reminders", true)
    .eq("is_active", true)
    .not("verification_status", "in", "(rejected,disabled)");
  if (currency) query = query.eq("currency", currency);
  const { data } = await query.maybeSingle();

  return (data as ReceivingAccountRow | null) ?? null;
}

// ─── saveReceivingAccountClient ───────────────────────────────────────────────

export async function saveReceivingAccountClient(
  input: ReceivingAccountInsert,
  confirmation = ""
): Promise<DbResult<ReceivingAccountRow>> {
  if (!isSupabaseConfigured) {
    const store = getMockStore();
    // If setting as primary, clear others
    if (input.is_primary) {
      store.forEach((a) => { if (a.currency === (input.currency ?? "MYR")) a.is_primary = false; });
    }
    const newRow: ReceivingAccountRow = {
      id:                   `mock-acct-${Date.now()}`,
      business_id:          input.business_id,
      currency:             input.currency ?? "MYR",
      business_entity_id:   input.business_entity_id ?? null,
      bank_name:            input.bank_name,
      account_holder_name:  input.account_holder_name,
      account_number:       input.account_number,
      duitnow_id:           input.duitnow_id ?? null,
      duitnow_qr_url:       input.duitnow_qr_url ?? null,
      include_in_reminders: input.include_in_reminders ?? true,
      is_primary:           input.is_primary ?? false,
      created_at:           new Date().toISOString(),
      updated_at:           new Date().toISOString(),
      version:              1,
      business_entity:      input.business_entity,
      payment_method:       input.payment_method,
      masked_display:       maskAccountIdentifier(input.account_number),
      qr_object_path:       input.qr_object_path ?? null,
      is_active:            true,
      verification_status:  "pending",
      created_by:           null,
      updated_by:           null,
      approved_by:          null,
      approved_at:          null,
    };
    store.push(newRow);
    return ok(newRow);
  }

  return apiMutation("/api/receiving-accounts", "POST", {
    businessEntity: input.business_entity, accountHolderName: input.account_holder_name,
    bankName: input.bank_name, paymentMethod: input.payment_method,
    accountIdentifier: input.account_number, duitnowId: input.duitnow_id,
    includeInReminders: input.include_in_reminders, isPrimary: input.is_primary, confirmation,
    currency: input.currency,
  });
}

// ─── updateReceivingAccountClient ─────────────────────────────────────────────

export async function updateReceivingAccountClient(
  id: string,
  patch: ReceivingAccountUpdate,
  confirmation = ""
): Promise<DbResult<ReceivingAccountRow>> {
  if (!isSupabaseConfigured) {
    const store = getMockStore();
    const idx   = store.findIndex((a) => a.id === id);
    if (idx === -1) return fail("Account not found");

    // If setting as primary, clear others first
    if (patch.is_primary) {
      const nextCurrency = patch.currency ?? store[idx].currency;
      store.forEach((a) => { if (a.currency === nextCurrency) a.is_primary = false; });
    }
    store[idx] = { ...store[idx], ...patch };
    return ok(store[idx]);
  }

  return apiMutation(`/api/receiving-accounts/${encodeURIComponent(id)}`, "PATCH", {
    businessEntity: patch.business_entity, accountHolderName: patch.account_holder_name,
    bankName: patch.bank_name, paymentMethod: patch.payment_method,
    accountIdentifier: patch.account_number, duitnowId: patch.duitnow_id,
    includeInReminders: patch.include_in_reminders, isPrimary: patch.is_primary, confirmation,
    currency: patch.currency,
  });
}

// ─── deleteReceivingAccountClient ─────────────────────────────────────────────

export async function deleteReceivingAccountClient(
  id: string,
  confirmation = ""
): Promise<DbResult<void>> {
  if (!isSupabaseConfigured) {
    const store = getMockStore();
    const idx   = store.findIndex((a) => a.id === id);
    if (idx === -1) return fail("Account not found");
    store[idx] = { ...store[idx], is_active: false, is_primary: false, include_in_reminders: false, verification_status: "disabled" };
    return ok(undefined);
  }

  const result = await apiMutation(`/api/receiving-accounts/${encodeURIComponent(id)}`, "DELETE", { confirmation });
  return result.error ? fail(result.error) : ok(undefined);
}

// ─── setPrimaryAccountClient ──────────────────────────────────────────────────

export async function setPrimaryAccountClient(
  id: string,
  confirmation = ""
): Promise<DbResult<void>> {
  if (!isSupabaseConfigured) {
    const store = getMockStore();
    store.forEach((a) => { a.is_primary = a.id === id; });
    return ok(undefined);
  }

  const result = await apiMutation(`/api/receiving-accounts/${encodeURIComponent(id)}`, "PATCH", { isPrimary: true, confirmation });
  return result.error ? fail(result.error) : ok(undefined);
}
