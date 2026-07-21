import { isSupabaseConfigured } from "@/lib/supabase/client";
import { getServerClient } from "@/lib/supabase/server-client";
import { type ReminderRow, type ReminderInsert } from "@/lib/supabase/types";
import { ok, fail, type DbResult } from "./result";
import { mockCaseActivities } from "@/lib/mock-data";

function activityToReminder(caseId: string, act: { id: string; description: string; time: string }): ReminderRow {
  return {
    id:            act.id,
    case_id:       caseId,
    message_type:  "friendly",
    message_body:  act.description,
    sent_channel:  "whatsapp",
    sent_at:       new Date().toISOString(),
    status:        "sent",
    error_message: null,
    template_version: 1,
    recipient: null,
    generated_at: new Date().toISOString(),
    composer_opened_at: null,
    manually_confirmed_at: null,
    next_action_at: null,
    request_key: act.id,
  };
}

export async function getReminders(
  caseId: string
): Promise<DbResult<ReminderRow[]>> {
  if (!isSupabaseConfigured) {
    const acts = (mockCaseActivities[caseId] ?? []).filter(
      (a) => a.type === "whatsapp" || a.type === "email"
    );
    return ok(acts.map((a) => activityToReminder(caseId, a)));
  }

  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("reminders")
    .select("*")
    .eq("case_id", caseId)
    .order("sent_at", { ascending: false });

  if (error) return fail(error.message);
  return ok(data ?? []);
}

export async function logReminder(
  input: ReminderInsert
): Promise<DbResult<ReminderRow>> {
  if (!isSupabaseConfigured) return fail("Supabase not configured");

  const client = await getServerClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("reminders")
    .insert(input)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data);
}
