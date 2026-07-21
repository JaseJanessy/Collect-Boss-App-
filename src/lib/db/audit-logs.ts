import { isSupabaseConfigured } from "@/lib/supabase/client";
import { getServerClient } from "@/lib/supabase/server-client";
import { type AuditLogRow, type AuditLogInsert, type Json } from "@/lib/supabase/types";
import { ok, fail, type DbResult } from "./result";

export async function getAuditLogs(
  caseId?: string
): Promise<DbResult<AuditLogRow[]>> {
  if (!isSupabaseConfigured) return ok([]);

  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  let query = client
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (caseId) query = query.eq("case_id", caseId);

  const { data, error } = await query;
  if (error) return fail(error.message);
  return ok(data ?? []);
}

/**
 * Append-only log entry. Never modifiable after creation.
 * Always call this after any significant action.
 */
export async function appendAuditLog(
  input: AuditLogInsert
): Promise<DbResult<AuditLogRow>> {
  if (!isSupabaseConfigured) {
    // Mock mode deliberately avoids emitting audit metadata to application logs.
    return ok({
      ...input,
      id:         "mock-audit-" + Date.now(),
      created_at: new Date().toISOString(),
    } as AuditLogRow);
  }

  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("audit_logs")
    .insert(input)
    .select()
    .single() as { data: AuditLogRow | null; error: { message: string } | null };

  if (error) return fail(error.message);
  if (!data)  return fail("No data returned");
  return ok(data);
}
