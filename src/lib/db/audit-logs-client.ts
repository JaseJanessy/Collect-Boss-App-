import { getBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { type AuditLogInsert } from "@/lib/supabase/types";

export async function appendAuditLogClient(input: AuditLogInsert): Promise<void> {
  if (!isSupabaseConfigured) {
    console.log("[AUDIT]", input.action, input.metadata);
    return;
  }

  const client = getBrowserClient();
  if (!client) return;

  await client.from("audit_logs").insert(input);
}
