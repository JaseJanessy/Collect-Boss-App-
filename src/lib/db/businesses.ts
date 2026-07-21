import "server-only";

import { isSupabaseConfigured } from "@/lib/supabase/client";
import { getServerClient } from "@/lib/supabase/server-client";
import { type BusinessRow, type BusinessInsert, type BusinessUpdate } from "@/lib/supabase/types";
import { ok, fail, type DbResult } from "./result";

const MOCK_BUSINESS: BusinessRow = {
  id:              "mock-business-id",
  owner_id:        "mock-owner-id",
  business_name:   "Demo Business Sdn Bhd",
  registration_no: "202401000001",
  account_type:    "business",
  legal_name:      "Demo Business Sdn Bhd",
  contact_name:    "Demo Owner",
  logo_object_path: null,
  phone:           "+60 12-345 6789",
  email:           "owner@demo.com",
  address:         "Kuala Lumpur, Wilayah Persekutuan",
  created_at:      new Date().toISOString(),
};

export async function getMyBusiness(): Promise<DbResult<BusinessRow | null>> {
  if (!isSupabaseConfigured) return ok(MOCK_BUSINESS);

  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const { data: { user } } = await client.auth.getUser();
  if (!user) return ok(null);

  const { data, error } = await client
    .from("businesses")
    .select("*")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (error) return fail(error.message);
  return ok(data);
}

export async function createBusiness(
  input: Omit<BusinessInsert, "owner_id">
): Promise<DbResult<BusinessRow>> {
  if (!isSupabaseConfigured) return fail("Supabase not configured");

  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const { data: { user } } = await client.auth.getUser();
  if (!user) return fail("You must be signed in to create a profile");

  const { data, error } = await client
    .from("businesses")
    .insert({ ...input, owner_id: user.id })
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data);
}

export async function updateBusiness(
  id: string,
  patch: BusinessUpdate
): Promise<DbResult<BusinessRow>> {
  if (!isSupabaseConfigured) return fail("Supabase not configured");

  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const { data: { user } } = await client.auth.getUser();
  if (!user) return fail("You must be signed in to update a profile");

  const { data, error } = await client
    .from("businesses")
    .update(patch)
    .eq("id", id)
    .eq("owner_id", user.id)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data);
}
