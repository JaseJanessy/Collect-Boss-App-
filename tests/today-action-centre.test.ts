import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const migration = () => read("supabase/migrations/20260813_today_action_centre.sql");

test("migration extends legacy actions with the complete operational model", () => {
  const sql = migration();
  for (const column of [
    "customer_id", "assignee_id", "reason", "amount_minor", "priority",
    "recommended_action", "source_event_id", "snoozed_until", "dedupe_key",
  ]) {
    assert.match(sql, new RegExp(`add column if not exists ${column}`));
  }
  for (const status of ["open", "in_progress", "snoozed", "completed", "dismissed"]) {
    assert.match(sql, new RegExp(`'${status}'`));
  }
  for (const priority of ["critical", "high", "medium", "low"]) {
    assert.match(sql, new RegExp(`'${priority}'`));
  }
  assert.match(sql, /update public\.action_centre_items a[\s\S]*customer_id = coalesce\(a\.customer_id, c\.debtor_id\)/);
  assert.match(sql, /dedupe_key = coalesce\(a\.dedupe_key, 'legacy:' \|\| a\.id::text\)/);
});

test("deterministic domain-event projection covers required recovery work without reading notifications", () => {
  const sql = migration();
  const consumer = sql.slice(
    sql.indexOf("create or replace function public.action_centre_consume_domain_events"),
    sql.indexOf("create or replace function public.action_centre_auto_close"),
  );
  for (const eventType of [
    "PROMISE_MISSED", "PLAN_INSTALLMENT_DUE", "PLAN_INSTALLMENT_MISSED",
    "FOLLOW_UP_DUE", "PAYMENT_PROOF_REVIEW_REQUIRED",
    "DISPUTE_REVIEW_DUE", "DISPUTE_SUBMITTED",
  ]) {
    assert.match(consumer, new RegExp(`'${eventType}'`));
  }
  assert.doesNotMatch(consumer, /from public\.notifications/);
  assert.match(consumer, /for update skip locked/);
  assert.match(consumer, /on conflict \(type, entity_id\) do update/);
  assert.match(sql, /action_centre_items_business_dedupe_uidx/);
  assert.match(consumer, /A missed installment supersedes/);
  assert.match(consumer, /s\.status::text in \('pending_review', 'submitted', 'under_review'\)/);
  assert.match(consumer, /i\.paid_minor < i\.amount_minor/);
  assert.match(consumer, /o\.status = 'disputed'/);
});

test("payment-plan responses create one explicit customer-response action", () => {
  const sql = migration();
  assert.match(sql, /create or replace function public\.action_centre_customer_response/);
  assert.match(sql, /after insert on public\.payment_plan_acknowledgements/);
  assert.match(sql, /'customer\.response', 'Customer responded to payment plan'/);
  assert.match(sql, /on conflict \(type, entity_id\) do nothing/);
});

test("underlying business completion closes active work and preserves history", () => {
  const sql = migration();
  for (const table of [
    "payment_plan_installments", "public_payment_submissions", "obligations",
    "legal_handoff_document_requests", "cases",
  ]) {
    assert.match(sql, new RegExp(`on public\\.${table}`));
  }
  assert.match(sql, /status in \('open', 'in_progress', 'snoozed'\)/);
  assert.match(sql, /set status = 'completed', completed_at = now\(\)/);
  assert.doesNotMatch(sql, /delete from public\.action_centre/);
  assert.match(sql, /action_centre_item_events/);
  assert.match(sql, /'auto_completed'/);
});

test("controlled snooze verifies ownership, duration and records actor history", () => {
  const sql = migration();
  assert.match(sql, /join public\.businesses b on b\.id = a\.business_id/);
  assert.match(sql, /b\.owner_id = auth\.uid\(\)/);
  assert.match(sql, /now\(\) \+ interval '15 minutes'/);
  assert.match(sql, /now\(\) \+ interval '30 days'/);
  assert.match(sql, /snooze_duration_seconds/);
  assert.match(sql, /v_actor_id uuid := auth\.uid\(\)/);
  assert.match(sql, /grant execute on function public\.action_centre_transition\(uuid,text,timestamptz\) to authenticated/);
});

test("RLS is tenant and assignee aware with mutations restricted to the reviewed RPC", () => {
  const sql = migration();
  const rls = read("src/lib/supabase/rls.sql");
  for (const source of [sql, rls]) {
    assert.match(source, /assignee_id is null or assignee_id = auth\.uid\(\)/);
    assert.match(source, /action_centre_item_events_owner_read/);
  }
  assert.doesNotMatch(rls, /create policy "action_centre_items_owner_update"/);
  assert.match(sql, /grant execute on function public\.action_centre_consume_domain_events\(integer\) to service_role/);
});

test("Today APIs use the permission-scoped dashboard RPC and expose auditable history", () => {
  const collection = read("src/app/api/action-centre/route.ts");
  const item = read("src/app/api/action-centre/[actionId]/route.ts");
  assert.match(collection, /action_centre_dashboard/);
  assert.match(collection, /getAuthenticatedBusiness\("case\.read"\)/);
  assert.match(collection, /p_scope: parsed\.scope/);
  assert.match(collection, /p_offset: parsed\.offset/);
  assert.match(collection, /nextCursor: encodeCursor/);
  assert.match(collection, /loadContactGuardEvaluations/);
  assert.match(item, /action_centre_transition/);
  assert.match(item, /snoozedUntil/);
  assert.match(item, /UUID_PATTERN/);
});

test("desktop, mobile and Action Centre route render the shared operational panel", () => {
  const desktop = read("src/components/pages/home-dashboard.tsx");
  const mobile = read("src/components/pages/home-mobile.tsx");
  const panel = read("src/components/action-centre/action-centre-panel.tsx");
  const route = read("src/app/actions/page.tsx");
  assert.match(desktop, /<ActionCentrePanel compact \/>/);
  assert.match(mobile, /<ActionCentrePanel compact \/>/);
  assert.match(route, /ActionCentrePage/);
  for (const label of ["All actions", "Outstanding represented", "Outstanding", "Due", "Owner", "Age", "Severity"]) {
    assert.match(panel, new RegExp(label));
  }
  assert.match(panel, /allowHistory/);
  assert.match(panel, /Snooze…/);
  assert.match(panel, /t\("dashboard\.sorted"\)/);
  assert.match(read("src/lib/i18n/messages.ts"), /Sorted by how serious each item is, then by due date/);
});

test("cron projects actions only after domain detection and notification projection", () => {
  const route = read("src/app/api/cron/domain-events/route.ts");
  const detector = route.indexOf('"domain_events_detect"');
  const notifications = route.indexOf('"notifications_consume_domain_events"');
  const actions = route.indexOf('"action_centre_consume_domain_events"');
  assert.ok(detector >= 0);
  assert.ok(notifications > detector);
  assert.ok(actions > notifications);
});
