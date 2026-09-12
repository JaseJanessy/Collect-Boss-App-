import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260917_pocket_reminders_notifications_whatsapp.sql");
const scheduler = read("src/lib/pocket/reminders-server.ts");
const composerRoute = read("src/app/api/pocket/reminders/compose/route.ts");
const reminderRoute = read("src/app/api/pocket/reminders/route.ts");
const reminderModel = read("src/lib/pocket/reminders.ts");
const reminderUi = read("src/components/pocket/pocket-reminders.tsx");
const pocketLedger = read("src/components/pocket/pocket-ledger.tsx");

test("Pocket reminders use an additive tenant-owned schedule and immutable handoff history", () => {
  for (const table of ["pocket_reminder_preferences", "pocket_reminder_schedules", "pocket_reminder_events"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /foreign key \(obligation_id,business_id\) references public\.obligations\(id,business_id\)/);
  assert.match(migration, /foreign key \(customer_id,business_id\) references public\.debtors\(id,business_id\)/);
  assert.match(migration, /business_id=public\.my_business_id\(\)/);
  assert.match(migration, /revoke all on public\.pocket_reminder_preferences,public\.pocket_reminder_schedules,public\.pocket_reminder_events from public,anon,authenticated/);
  assert.match(migration, /grant all on public\.pocket_reminder_preferences,public\.pocket_reminder_schedules,public\.pocket_reminder_events to service_role/);
});

test("debt, balance, status, archive, due-date and contact changes cancel pending work", () => {
  for (const field of ["customer_id", "pocket_due_date", "original_amount_minor", "adjustments_minor", "paid_minor", "status", "archived_at"]) {
    assert.match(migration, new RegExp(`new\\.${field} is distinct from old\\.${field}`));
  }
  assert.match(migration, /after update of phone,archived_at,merged_into_id on public\.debtors/);
  assert.match(migration, /status='cancelled',snoozed_until=null,cancellation_reason='debt_changed'/);
  assert.match(migration, /status in \('pending','snoozed'\)/);
});

test("scheduler is timezone-safe, deterministic and retry deduplicated", () => {
  assert.match(scheduler, /workspaceLocalDate\(String\(business\.timezone/);
  assert.match(scheduler, /buildPocketReminderCandidates/);
  assert.match(scheduler, /source_fingerprint: sha256/);
  assert.match(scheduler, /onConflict: "business_id,source_key"/);
  assert.match(scheduler, /dedupeKey = `pocket-reminder:\$\{schedule\.source_key\}`/);
  assert.match(scheduler, /onConflict: "business_id,dedupe_key", ignoreDuplicates: true/);
  assert.match(migration, /unique \(business_id,source_key\)/);
  assert.match(migration, /unique \(business_id,idempotency_key\)/);
});

test("shared owner notifications and push use an authorised Pocket deep link and per-reminder push setting", () => {
  assert.match(scheduler, /action_url: schedule\.invoice_id \? `\/pocket\/invoices\/\$\{schedule\.invoice_id\}` : `\/pocket\/reminders\/\$\{schedule\.id\}`/);
  assert.match(scheduler, /entity_type: "pocket_reminder_schedule"/);
  assert.match(scheduler, /push_enabled: preference\?\.push_enabled \?\? true/);
  assert.match(read("src/lib/notifications/push.ts"), /\.eq\('push_enabled', true\)/);
  assert.match(composerRoute, /\.eq\("id", parsed\.data\.scheduleId\)\.eq\("business_id", access\.businessId\)/);
});

test("WhatsApp handoff is multilingual, trusted, encoded, reviewed and never auto-sent", () => {
  for (const language of ["en", "ms", "zh"]) assert.match(reminderModel, new RegExp(`${language}: \\{`));
  for (const template of ["gentle", "due_today", "overdue", "partial_balance"]) assert.match(reminderModel, new RegExp(`${template}:`));
  assert.match(reminderModel, /formatCurrencyMinor\(values\.remainingMinor/);
  assert.match(reminderModel, /encodeURIComponent\(normalizedMessage\)/);
  assert.match(composerRoute, /Idempotency-Key header is required/);
  assert.match(composerRoute, /pocket\.reminder\.opened_to_whatsapp/);
  assert.match(reminderUi, /only you can tap Send/);
  assert.match(reminderUi, /does not claim the message was sent, delivered, or read/);
  assert.doesNotMatch(scheduler + composerRoute + reminderModel, /graph\.facebook\.com|messages\/send|whatsapp_business_messaging/);
});

test("Pocket UI exposes grouped cards, Home totals, Remind All and customer handoff history", () => {
  for (const label of ["Today", "Overdue", "Payments", "Send Reminder", "Reminder Prepared", "Opened to WhatsApp"]) assert.match(reminderUi, new RegExp(label));
  assert.match(pocketLedger, /Due Today/);
  assert.match(pocketLedger, /dueTotal/);
  assert.match(pocketLedger, /Remind All/);
  assert.match(pocketLedger, /Last reminder:/);
  assert.match(read("src/app/api/pocket/customers/[customerId]/route.ts"), /\.eq\("business_id", access\.businessId\)\.eq\("customer_id", customerId\)/);
  assert.match(reminderRoute, /pocket\.reminder\.manage/);
});

test("Prompt 7 does not claim unsupported expected-payment, invoice, delivery or read states", () => {
  assert.doesNotMatch(migration.match(/pocket_reminder_events[\s\S]*?\);/)?.[0] ?? "", /sent|delivered|read/);
  assert.doesNotMatch(reminderModel, /expected_payment|invoice_due/);
  assert.match(scheduler, /deliveryStatus: "not_sent"/);
  assert.match(scheduler, /deliveryStatus: "unknown"/);
  assert.match(scheduler, /readStatus: "unknown"/);
});
