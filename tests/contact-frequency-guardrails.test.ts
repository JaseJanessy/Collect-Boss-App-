import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260819_contact_frequency_guardrails.sql");
const schema = read("supabase/schema.sql");
const rls = read("src/lib/supabase/rls.sql");

test("rolling contact counts come from unified real communication activity", () => {
  assert.match(migration, /from public\.communication_activities ca/);
  for (const period of ["24 hours", "7 days", "30 days"]) assert.match(migration, new RegExp(`interval '${period}'`));
  assert.match(migration, /ca\.direction='outbound'/);
  assert.match(migration, /contact_guard_context/);
  assert.match(schema, /create table if not exists public\.contact_frequency_policies/);
});

test("documented contact preferences and configurable policy cover every required control", () => {
  for (const field of [
    "preferred_channel", "preferred_time_start", "preferred_time_end", "email_only",
    "do_not_call", "wrong_number", "invalid_contact",
  ]) assert.match(migration, new RegExp(field));
  for (const field of ["max_attempts_24h", "max_attempts_7d", "max_attempts_30d", "frequency_mode", "preference_mode", "bulk_mode"]) {
    assert.match(migration, new RegExp(field));
  }
  assert.match(migration, /frequency_mode in \('warn','require_override'\)/);
  assert.match(migration, /bulk_mode in \('exclude','require_override'\)/);
});

test("RLS is tenant-read-only and preference, policy and override writes use owner RPCs", () => {
  for (const policy of [
    "contact_frequency_policies_owner_read", "contact_preferences_owner_read",
    "contact_guard_overrides_owner_read",
  ]) {
    assert.match(migration, new RegExp(policy));
    assert.match(rls, new RegExp(policy));
  }
  assert.doesNotMatch(rls, /contact_(preferences|frequency_policies|guard_overrides)_owner_(insert|update|delete)/);
  assert.match(migration, /b\.owner_id=auth\.uid\(\)/);
  assert.match(migration, /grant execute on function public\.contact_preferences_upsert/);
  assert.match(migration, /grant execute on function public\.contact_guard_record_override/);
});

test("single, reminder, Action Centre and bulk paths share the guardrail", () => {
  const communications = read("src/app/api/cases/[caseId]/communications/route.ts");
  const reminders = read("src/app/api/cases/[caseId]/reminders/route.ts");
  const actions = read("src/app/api/action-centre/route.ts");
  const bulk = read("src/app/api/communications/bulk-preflight/route.ts");
  assert.match(communications, /loadContactGuardContexts/);
  assert.match(reminders, /evaluateContactGuard/);
  assert.match(actions, /loadContactGuardEvaluations/);
  assert.match(actions, /recommended_action: contactGuard/);
  assert.match(bulk, /bulk_allowed/);
  assert.match(bulk, /excluded/);
});

test("high-frequency overrides are durable, actor-bound and audited", () => {
  assert.match(migration, /create table if not exists public\.contact_guard_overrides/);
  assert.match(migration, /overridden_by uuid not null references auth\.users/);
  assert.match(migration, /contact_guard_overrides_activity_uidx/);
  assert.match(migration, /'contact_guard\.overridden'/);
  const communicationUi = read("src/components/cases/communication-activity.tsx");
  assert.match(communicationUi, /enter a short operational reason/i);
});

