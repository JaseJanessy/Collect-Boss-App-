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
  industry:        "general",
  verification_state: "unverified",
  verification_submitted_at: null,
  verified_at: null,
  verification_public_note: null,
  payment_links_restricted_until: null,
  payment_link_restriction_reason: null,
  account_type:    "business",
  legal_name:      "Demo Business Sdn Bhd",
  contact_name:    "Demo Owner",
  logo_object_path: null,
  phone:           "+60 12-345 6789",
  phone_e164:      "+60123456789",
  email:           "owner@demo.com",
  address:         "Kuala Lumpur, Wilayah Persekutuan",
  address_details: {},
  country_code:    "MY",
  locale:          "en-MY",
  default_currency: "MYR",
  date_format:     "locale",
  number_format:   "locale",
  language_code:   "en",
  registration_identifiers: [{ type: "business_registration", value: "202401000001", label: "SSM registration number", issuingCountry: "MY" }],
  region_defaults_source: "legacy_malaysia_v1",
  region_defaults_determined_at: new Date().toISOString(),
  credit_limit_enforcement_enabled: false,
  timezone:        "Asia/Kuala_Lumpur",
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
