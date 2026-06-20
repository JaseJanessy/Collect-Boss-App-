import { getServerClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { type BusinessRow, type BusinessInsert, type BusinessUpdate } from "@/lib/supabase/types";
import { ok, fail, type DbResult } from "./result";

const MOCK_BUSINESS: BusinessRow = {
  id:              "mock-business-id",
  owner_id:        "mock-owner-id",
  business_name:   "Demo Business Sdn Bhd",
  registration_no: "202401000001",
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
  input: BusinessInsert
): Promise<DbResult<BusinessRow>> {
  if (!isSupabaseConfigured) return fail("Supabase not configured");

  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("businesses")
    .insert(input)
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

  const { data, error } = await client
    .from("businesses")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data);
}
