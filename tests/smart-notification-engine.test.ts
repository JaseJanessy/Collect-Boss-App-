import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const migration = () => read("supabase/migrations/20260812_smart_notification_engine.sql");

test("migration extends legacy notifications with the complete persistent model", () => {
  const sql = migration();
  for (const column of [
    "user_id", "customer_id", "event_type", "severity", "action_url",
    "archived_at", "dedupe_key", "domain_event_id",
  ]) {
    assert.match(sql, new RegExp(`add column if not exists ${column}`));
  }
  for (const severity of ["critical", "high", "medium", "informational", "positive"]) {
    assert.match(sql, new RegExp(`'${severity}'`));
  }
  assert.match(sql, /alter column event_type set not null/);
  assert.match(sql, /alter column dedupe_key set not null/);
  assert.match(sql, /notifications_action_url_check/);
  assert.match(sql, /left\(action_url, 2\) <> '\/\//);
});

test("domain events project once into notifications without creating work actions or messages", () => {
  const sql = migration();
  assert.match(sql, /create or replace function public\.notifications_consume_domain_events/);
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /on conflict \(business_id, dedupe_key\) do nothing/);
  assert.match(sql, /'domain-event:' \|\| de\.id::text/);
  assert.match(sql, /create unique index if not exists notifications_domain_event_uidx/);

  const consumer = sql.slice(sql.indexOf("create or replace function public.notifications_consume_domain_events"));
  assert.doesNotMatch(consumer, /insert into public\.(action_centre_items|reminders|messages)/);
  assert.match(consumer, /when 'PAYMENT_RECEIVED' then 'positive'/);
  assert.match(consumer, /else 'informational'/);
});

test("payment receipts and submitted disputes create tenant-owned source events", () => {
  const sql = migration();
  assert.match(sql, /case_financial_event_notification_trigger/);
  assert.match(sql, /new\.event_type <> 'payment_approved'/);
  assert.match(sql, /'PAYMENT_RECEIVED', 'case_financial_event'/);
  assert.match(sql, /obligation_dispute_notification_trigger/);
  assert.match(sql, /new\.status <> 'disputed'/);
  assert.match(sql, /'DISPUTE_SUBMITTED', 'obligation_dispute'/);
  assert.match(sql, /where c\.id = new\.case_id/);
  assert.match(sql, /where b\.id = new\.business_id/);
});

test("RLS limits notification reads and state changes to tenant and optional recipient", () => {
  const sql = migration();
  const rls = read("src/lib/supabase/rls.sql");
  for (const source of [sql, rls]) {
    assert.match(source, /user_id is null or user_id = auth\.uid\(\)/);
  }
  assert.match(sql, /Only notification read\/archive state may be changed directly/);
  assert.doesNotMatch(rls, /notifications_owner_(insert|delete)/);
  assert.match(sql, /grant execute on function public\.notifications_consume_domain_events\(integer\) to service_role/);
});

test("notification APIs explicitly scope every operation and expose durable bell operations", () => {
  const collection = read("src/app/api/notifications/route.ts");
  const item = read("src/app/api/notifications/[notificationId]/route.ts");
  for (const route of [collection, item]) {
    assert.match(route, /\.eq\("business_id", auth\.businessId\)/);
    assert.match(route, /private, no-store/);
  }
  assert.match(collection, /head: true/);
  assert.match(collection, /mark_all_read/);
  assert.match(collection, /\.is\("archived_at", null\)/);
  assert.match(collection, /\.is\("read_at", null\)/);
  assert.match(item, /mark_read/);
  assert.match(item, /archive/);
  assert.match(item, /UUID_PATTERN/);
});

test("desktop and mobile bells use persistent counts, previews and deep links", () => {
  const bell = read("src/components/notifications/notification-bell.tsx");
  const desktop = read("src/components/shells/dashboard-shell.tsx");
  const mobile = read("src/components/shells/mobile-shell.tsx");
  const page = read("src/components/pages/notifications-page.tsx");
  assert.match(desktop, /<NotificationBell \/>/);
  assert.match(mobile, /<NotificationBell mobile \/>/);
  assert.doesNotMatch(desktop, /bg-red-500 rounded-full/);
  assert.doesNotMatch(mobile, /bg-red-500 rounded-full/);
  assert.match(bell, /unreadCount/);
  assert.match(bell, /Mark all read/);
  assert.match(bell, /View all notifications/);
  assert.match(bell, /href=\{item\.action_url/);
  assert.match(page, /Mark read/);
  assert.match(page, /Archive/);
});

test("scheduled detection and notification projection remain separate retryable calls", () => {
  const route = read("src/app/api/cron/domain-events/route.ts");
  const detectorAt = route.indexOf('"domain_events_detect"');
  const consumerAt = route.indexOf('"notifications_consume_domain_events"');
  assert.ok(detectorAt >= 0);
  assert.ok(consumerAt > detectorAt);
  assert.match(route, /Domain events were detected, but notification projection failed/);
});
