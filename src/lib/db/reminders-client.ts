/**
 * Client-side reminders CRUD.
 * Falls back to in-memory mock store when Supabase is not configured.
 */

import { getBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { type ReminderRow, type ReminderInsert, type ReminderStatus } from "@/lib/supabase/types";
import { ok, fail, type DbResult } from "./result";

// ─── Mock store ───────────────────────────────────────────────────────────────

const _mockStore: Record<string, ReminderRow[]> = {};

function getMockList(caseId: string): ReminderRow[] {
  if (!_mockStore[caseId]) _mockStore[caseId] = [];
  return _mockStore[caseId];
}

function mockGenerateId(): string {
  return `mock-rem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ─── getRemindersClient ───────────────────────────────────────────────────────

export async function getRemindersClient(
  caseId: string
): Promise<DbResult<ReminderRow[]>> {
  if (!isSupabaseConfigured) {
    return ok([...getMockList(caseId)]);
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("reminders")
    .select("*")
    .eq("case_id", caseId)
    .order("sent_at", { ascending: false });

  if (error) return fail(error.message);
  return ok((data as ReminderRow[]) ?? []);
}

// ─── saveReminderClient ───────────────────────────────────────────────────────

export async function saveReminderClient(
  input: ReminderInsert
): Promise<DbResult<ReminderRow>> {
  if (!isSupabaseConfigured) {
    const newRow: ReminderRow = {
      id:            mockGenerateId(),
      case_id:       input.case_id,
      message_type:  input.message_type,
      message_body:  input.message_body,
      sent_channel:  input.sent_channel,
      sent_at:       input.sent_at ?? new Date().toISOString(),
      status:        input.status ?? "draft",
      error_message: input.error_message ?? null,
    };
    getMockList(input.case_id).unshift(newRow);
    return ok(newRow);
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("reminders")
    .insert(input)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data as ReminderRow);
}

// ─── updateReminderStatusClient ───────────────────────────────────────────────

export async function updateReminderStatusClient(
  id: string,
  status: ReminderStatus
): Promise<DbResult<ReminderRow>> {
  if (!isSupabaseConfigured) {
    for (const caseId of Object.keys(_mockStore)) {
      const idx = _mockStore[caseId].findIndex((r) => r.id === id);
      if (idx !== -1) {
        _mockStore[caseId][idx] = { ..._mockStore[caseId][idx], status };
        return ok(_mockStore[caseId][idx]);
      }
    }
    return fail("Reminder not found");
  }

  const client = getBrowserClient();
  if (!client) return fail("Supabase client unavailable");

  const { data, error } = await client
    .from("reminders")
    .update({ status })
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok(data as ReminderRow);
}
