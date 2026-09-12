import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260814_promise_to_pay.sql");
const schema = read("supabase/schema.sql");
const rls = read("src/lib/supabase/rls.sql");

test("promise is a first-class tenant-scoped recovery object", () => {
  for (const source of ["whatsapp", "call", "email", "portal", "in_person", "manual"]) {
    assert.match(migration, new RegExp(`'${source}'`));
  }
  for (const status of ["pending", "partially_fulfilled", "fulfilled", "missed", "cancelled"]) {
    assert.match(migration, new RegExp(`'${status}'`));
  }
  assert.match(migration, /payment_promises_one_active_per_case_uidx/);
  assert.match(migration, /unique \(business_id, idempotency_key\)/);
  assert.match(schema, /create table if not exists payment_promises/);
});

test("only an explicitly selected approved same-case payment fulfils a promise", () => {
  const matcher = migration.slice(
    migration.indexOf("create or replace function public.payment_promise_apply_payment"),
    migration.indexOf("create or replace function public.payment_promise_cancel"),
  );
  assert.match(matcher, /v_payment\.case_id<>v_promise\.case_id/);
  assert.match(matcher, /v_payment\.review_status<>'approved'/);
  assert.match(matcher, /v_payment\.created_at < v_promise\.created_at/);
  assert.match(matcher, /authorised_override/);
  assert.match(matcher, /An override reason is required/);
  assert.doesNotMatch(migration, /from public\.case_financial_events[\s\S]*update public\.payment_promises/i);
});

test("partial, full, reversal and override transitions remain auditable", () => {
  assert.match(migration, /then 'fulfilled' else 'partially_fulfilled'/);
  assert.match(migration, /payment_promise_recalculate_after_reversal/);
  assert.match(migration, /'payment_reversed'/);
  assert.match(migration, /'payment_promise\.match_overridden'/);
  assert.match(migration, /insert into public\.payment_promise_events/);
  assert.match(migration, /insert into public\.audit_logs/);
});

test("missed scheduler is timezone-aware, retry-safe and creates one action", () => {
  assert.match(migration, /timezone\(b\.timezone,p_now\)::date/);
  assert.match(migration, /payment_promise_events_missed_once_uidx/);
  assert.match(migration, /on conflict \(deduplication_key\)/);
  assert.match(migration, /'payment-promise-missed:'\|\|v_row\.id::text/);
  assert.match(migration, /grant execute on function public\.payment_promises_run_scheduler\(timestamptz\) to service_role/);
  const cron = read("src/app/api/cron/domain-events/route.ts");
  const promisesAt = cron.indexOf('"payment_promises_run_scheduler"');
  const legacyAt = cron.indexOf('"domain_events_detect"');
  assert.ok(promisesAt >= 0 && promisesAt < legacyAt);
});

test("promise tables expose tenant reads only and mutations use owner RPCs", () => {
  for (const name of ["payment_promises_owner_read", "payment_promise_allocations_owner_read", "payment_promise_events_owner_read"]) {
    assert.match(migration, new RegExp(name));
    assert.match(rls, new RegExp(name));
  }
  assert.doesNotMatch(rls, /payment_promises_owner_(insert|update|delete)/);
  assert.match(migration, /b\.owner_id=auth\.uid\(\)/);
  const route = read("src/app/api/cases/[caseId]/promises/route.ts");
  assert.match(route, /eq\("business_id", access\.businessId\)/);
  assert.doesNotMatch(route, /getServiceClient/);
});

test("case overview and timeline surface promise lifecycle", () => {
  const casePage = read("src/components/pages/case-detail-page.tsx");
  const card = read("src/components/cases/payment-promise-card.tsx");
  assert.match(casePage, /PaymentPromiseCard/);
  assert.match(casePage, /PaymentPromiseTimeline/);
  assert.match(card, /Only the payment selected here counts toward this promise/);
  assert.match(card, /Authorised override/);
});
