import { getServerClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  type LegalDocumentRow,
  type LegalDocumentInsert,
  type LegalDocumentUpdate,
} from "@/lib/supabase/types";
import { ok, fail, type DbResult } from "./result";

export async function getLegalDocuments(
  caseId: string
): Promise<DbResult<LegalDocumentRow[]>> {
  if (!isSupabaseConfigured) return ok([]);

  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("legal_documents")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });

  if (error) return fail(error.message);
  return ok(data ?? []);
}

export async function saveLegalDocument(
  input: LegalDocumentInsert
): Promise<DbResult<LegalDocumentRow>> {
  if (!isSupabaseConfigured) return fail("Supabase not configured");

  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("legal_documents")
    .insert(input)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data);
}

export async function updateLegalDocument(
  id: string,
  patch: LegalDocumentUpdate
): Promise<DbResult<LegalDocumentRow>> {
  if (!isSupabaseConfigured) return fail("Supabase not configured");

  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("legal_documents")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data);
}
