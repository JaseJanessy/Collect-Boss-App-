import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260818_unified_communication_activity.sql");
const schema = read("supabase/schema.sql");
const rls = read("src/lib/supabase/rls.sql");

test("communication activity models every V1 channel and WhatsApp delivery state", () => {
  for (const channel of ["whatsapp", "call", "email", "portal", "other"]) {
    assert.match(migration, new RegExp(`'${channel}'`));
  }
  for (const status of ["initiated", "sent", "delivered", "read", "replied", "failed"]) {
    assert.match(migration, new RegExp(`'${status}'`));
  }
  for (const field of [
    "business_id", "customer_id", "case_id", "direction", "started_at", "completed_at",
    "staff_user_id", "external_reference", "duration_seconds", "metadata",
    "related_promise_id", "related_dispute_id", "related_action_id",
  ]) {
    assert.match(migration, new RegExp(field));
  }
  assert.match(schema, /create table if not exists public\.communication_activities/);
});

test("tenant scope and related entities are enforced in SQL, not trusted to the browser", () => {
  assert.match(migration, /communication_activity_validate_scope/);
  assert.match(migration, /v_case\.business_id <> new\.business_id/);
  assert.match(migration, /new\.customer_id is distinct from v_case\.debtor_id/);
  assert.match(migration, /b\.owner_id=auth\.uid\(\)/);
  assert.match(migration, /communication_activities_owner_read/);
  assert.match(rls, /communication_activities_owner_read/);
  assert.doesNotMatch(rls, /communication_activities_owner_(insert|update|delete)/);
});

test("call handoff has one-tap outcomes and all activity reaches the case timeline", () => {
  const component = read("src/components/cases/communication-activity.tsx");
  const casePage = read("src/components/pages/case-detail-page.tsx");
  for (const label of [
    "No Answer", "Spoke to Customer", "Promise to Pay", "Call Back Later",
    "Payment Difficulty", "Other",
  ]) {
    assert.match(read("src/lib/communications/model.ts"), new RegExp(label));
  }
  assert.match(component, /callHandoffAdapter/);
  assert.match(component, /whatsappHandoffAdapter/);
  assert.match(casePage, /CommunicationTimeline/);
  assert.match(casePage, /CommunicationActivityPanel/);
});

test("future official WhatsApp updates share the activity status model", () => {
  const adapters = read("src/lib/communications/adapters.ts");
  const updateRoute = read("src/app/api/cases/[caseId]/communications/[activityId]/route.ts");
  assert.match(adapters, /normalizeWhatsAppProviderStatus/);
  assert.match(adapters, /official WhatsApp Business Platform/);
  assert.match(updateRoute, /communication_activity_update/);
  assert.match(migration, /communication_activities_external_ref_uidx/);
});

test("existing and future reminder handoffs use the unified activity model", () => {
  const reminderRoute = read("src/app/api/cases/[caseId]/reminders/route.ts");
  assert.match(migration, /from public\.reminders r/);
  assert.match(migration, /on conflict \(business_id,idempotency_key\) do nothing/);
  assert.match(reminderRoute, /ensureReminderCommunication/);
  assert.match(reminderRoute, /communication_activity_create/);
  assert.match(reminderRoute, /communication_activity_update/);
});
