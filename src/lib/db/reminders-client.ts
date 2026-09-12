/**
 * Client-side reminders CRUD.
 * Falls back to in-memory mock store when Supabase is not configured.
 */

import { isSupabaseConfigured } from "@/lib/supabase/client";
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

  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/reminders`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as { reminders?: ReminderRow[]; error?: string };
  if (!response.ok || !payload.reminders) return fail(payload.error ?? "Unable to load communication history.");
  return ok(payload.reminders);
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
      template_version: input.template_version ?? 1,
      recipient: input.recipient ?? null,
      generated_at: input.generated_at ?? new Date().toISOString(),
      composer_opened_at: input.composer_opened_at ?? null,
      manually_confirmed_at: input.manually_confirmed_at ?? null,
      next_action_at: input.next_action_at ?? null,
      request_key: input.request_key ?? crypto.randomUUID(),
      dispute_snapshot_minor: input.dispute_snapshot_minor ?? null,
      collectable_snapshot_minor: input.collectable_snapshot_minor ?? null,
    };
    getMockList(input.case_id).unshift(newRow);
    return ok(newRow);
  }

  return fail("Use the reminder API to generate messages.");
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

  return fail("Use the reminder API to record communication status.");
}

export async function generateReminderClient(input: { caseId: string; messageType: string; channel: "whatsapp" | "email"; requestKey: string; messageBody: string }): Promise<DbResult<ReminderRow>> {
  if (!isSupabaseConfigured) {
    const existing = getMockList(input.caseId).find((reminder) => reminder.request_key === input.requestKey);
    if (existing) return ok(existing);
    return saveReminderClient({
      case_id: input.caseId, message_type: input.messageType, message_body: input.messageBody,
      sent_channel: input.channel, status: "draft", error_message: null, request_key: input.requestKey,
    });
  }
  const response = await fetch(`/api/cases/${encodeURIComponent(input.caseId)}/reminders`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "generate", messageType: input.messageType, channel: input.channel, requestKey: input.requestKey }),
  });
  const payload = await response.json().catch(() => ({})) as { reminder?: ReminderRow; error?: string };
  if (!response.ok || !payload.reminder) return fail(payload.error ?? "Unable to generate reminder.");
  return ok(payload.reminder);
}

export async function recordReminderHandoffClient(caseId: string, reminderId: string, handoff: "copy" | "whatsapp" | "email", overrideReason?: string): Promise<DbResult<ReminderRow>> {
  if (!isSupabaseConfigured) return updateMockReminder(reminderId, handoff === "copy" ? { status: "copied" } : { composer_opened_at: new Date().toISOString() });
  return reminderAction(caseId, { action: "handoff", reminderId, handoff, overrideReason });
}

export async function confirmReminderSentClient(caseId: string, reminderId: string, nextActionAt?: string, overrideReason?: string): Promise<DbResult<ReminderRow>> {
  if (!isSupabaseConfigured) return updateMockReminder(reminderId, {
    status: "sent_manually", manually_confirmed_at: new Date().toISOString(),
    next_action_at: nextActionAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
  return reminderAction(caseId, { action: "confirm_sent", reminderId, nextActionAt, overrideReason });
}

function updateMockReminder(id: string, patch: Partial<ReminderRow>): DbResult<ReminderRow> {
  for (const caseId of Object.keys(_mockStore)) {
    const index = _mockStore[caseId].findIndex((reminder) => reminder.id === id);
    if (index !== -1) {
      _mockStore[caseId][index] = { ..._mockStore[caseId][index], ...patch };
      return ok(_mockStore[caseId][index]);
    }
  }
  return fail("Reminder not found");
}

async function reminderAction(caseId: string, body: Record<string, unknown>): Promise<DbResult<ReminderRow>> {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/reminders`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as { reminder?: ReminderRow; error?: string };
  if (!response.ok || !payload.reminder) return fail(payload.error ?? "Unable to update reminder.");
  return ok(payload.reminder);
}
