import { isSupabaseConfigured } from "@/lib/supabase/client";
import { getServerClient } from "@/lib/supabase/server-client";
import {
  type ReceivingAccountRow,
  type ReceivingAccountInsert,
  type ReceivingAccountUpdate,
} from "@/lib/supabase/types";
import { ok, fail, type DbResult } from "./result";
import { mockReceivingAccounts } from "@/lib/mock-payment-data";

function mockToRow(a: (typeof mockReceivingAccounts)[0]): ReceivingAccountRow {
  return {
    id:                   a.id,
    business_id:          "mock-business-id",
    bank_name:            a.bankName,
    account_holder_name:  a.accountHolder,
    account_number:       a.accountNumber,
    duitnow_id:           a.duitnowId,
    duitnow_qr_url:       null,
    include_in_reminders: a.includeInReminder,
    is_primary:           a.isPrimary,
    created_at:           new Date().toISOString(),
    updated_at:           new Date().toISOString(),
    version:              1,
  };
}

export async function getReceivingAccounts(): Promise<DbResult<ReceivingAccountRow[]>> {
  if (!isSupabaseConfigured) {
    return ok(mockReceivingAccounts.map(mockToRow));
  }

  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("receiving_accounts")
    .select("*")
    .order("is_primary", { ascending: false });

  if (error) return fail(error.message);
  return ok(data ?? []);
}

export async function getPrimaryAccount(): Promise<DbResult<ReceivingAccountRow | null>> {
  if (!isSupabaseConfigured) {
    const primary = mockReceivingAccounts.find((a) => a.isPrimary);
    return ok(primary ? mockToRow(primary) : null);
  }

  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("receiving_accounts")
    .select("*")
    .eq("is_primary", true)
    .maybeSingle();

  if (error) return fail(error.message);
  return ok(data);
}

export async function upsertReceivingAccount(
  input: ReceivingAccountInsert
): Promise<DbResult<ReceivingAccountRow>> {
  if (!isSupabaseConfigured) return fail("Supabase not configured");

  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("receiving_accounts")
    .upsert(input)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data);
}

export async function updateReceivingAccount(
  id: string,
  patch: ReceivingAccountUpdate
): Promise<DbResult<ReceivingAccountRow>> {
  if (!isSupabaseConfigured) return fail("Supabase not configured");

  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("receiving_accounts")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data);
}
