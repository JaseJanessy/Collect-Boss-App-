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

// ─── Mock store ───────────────────────────────────────────────────────────────

let _mockStore: ReceivingAccountRow[] | null = null;

function mockToRow(
  a: (typeof mockReceivingAccounts)[0]
): ReceivingAccountRow {
  return {
    id:                   a.id,
    business_id:          "mock-business-id",
    bank_name:            a.bankName,
    account_holder_name:  a.accountHolder,
    account_number:       a.accountNumber,
    duitnow_id:           a.duitnowId ?? null,
    duitnow_qr_url:       null,
    include_in_reminders: a.includeInReminder,
    is_primary:           a.isPrimary,
    created_at:           new Date().toISOString(),
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

export async function getPrimaryAccountClient(): Promise<ReceivingAccountRow | null> {
  if (!isSupabaseConfigured) {
    return getMockStore().find((a) => a.is_primary && a.include_in_reminders) ?? null;
  }
  const client = getBrowserClient();
  if (!client) return null;

  const { data } = await client
    .from("receiving_accounts")
    .select("*")
    .eq("is_primary", true)
    .eq("include_in_reminders", true)
    .maybeSingle();

  return (data as ReceivingAccountRow | null) ?? null;
}

// ─── saveReceivingAccountClient ───────────────────────────────────────────────

export async function saveReceivingAccountClient(
  input: ReceivingAccountInsert
): Promise<DbResult<ReceivingAccountRow>> {
  if (!isSupabaseConfigured) {
    const store = getMockStore();
    // If setting as primary, clear others
    if (input.is_primary) {
      store.forEach((a) => { a.is_primary = false; });
    }
    const newRow: ReceivingAccountRow = {
      id:                   `mock-acct-${Date.now()}`,
      business_id:          input.business_id,
      bank_name:            input.bank_name,
      account_holder_name:  input.account_holder_name,
      account_number:       input.account_number,
      duitnow_id:           input.duitnow_id ?? null,
      duitnow_qr_url:       input.duitnow_qr_url ?? null,
      include_in_reminders: input.include_in_reminders ?? true,
      is_primary:           input.is_primary ?? false,
      created_at:           new Date().toISOString(),
    };
    store.push(newRow);
    return ok(newRow);
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("receiving_accounts")
    .insert(input)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data as ReceivingAccountRow);
}

// ─── updateReceivingAccountClient ─────────────────────────────────────────────

export async function updateReceivingAccountClient(
  id: string,
  patch: ReceivingAccountUpdate
): Promise<DbResult<ReceivingAccountRow>> {
  if (!isSupabaseConfigured) {
    const store = getMockStore();
    const idx   = store.findIndex((a) => a.id === id);
    if (idx === -1) return fail("Account not found");

    // If setting as primary, clear others first
    if (patch.is_primary) {
      store.forEach((a) => { a.is_primary = false; });
    }
    store[idx] = { ...store[idx], ...patch };
    return ok(store[idx]);
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("receiving_accounts")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data as ReceivingAccountRow);
}

// ─── deleteReceivingAccountClient ─────────────────────────────────────────────

export async function deleteReceivingAccountClient(
  id: string
): Promise<DbResult<void>> {
  if (!isSupabaseConfigured) {
    const store = getMockStore();
    const idx   = store.findIndex((a) => a.id === id);
    if (idx === -1) return fail("Account not found");
    store.splice(idx, 1);
    return ok(undefined);
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { error } = await client
    .from("receiving_accounts")
    .delete()
    .eq("id", id);

  if (error) return fail(error.message);
  return ok(undefined);
}

// ─── setPrimaryAccountClient ──────────────────────────────────────────────────

export async function setPrimaryAccountClient(
  id: string
): Promise<DbResult<void>> {
  if (!isSupabaseConfigured) {
    const store = getMockStore();
    store.forEach((a) => { a.is_primary = a.id === id; });
    return ok(undefined);
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  // Unset all primaries first, then set the new one
  const { error: clearErr } = await client
    .from("receiving_accounts")
    .update({ is_primary: false } as ReceivingAccountUpdate)
    .neq("id", id);

  if (clearErr) return fail(clearErr.message);

  const { error } = await client
    .from("receiving_accounts")
    .update({ is_primary: true } as ReceivingAccountUpdate)
    .eq("id", id);

  if (error) return fail(error.message);
  return ok(undefined);
}
