import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  domainEventDeduplicationKey,
  dueEventDate,
  localDateAt,
} from "../src/lib/domain-events/scheduling.ts";

const read = (path: string) => readFileSync(path, "utf8");

test("tenant-local dates differ correctly around the international date line", () => {
  const instant = new Date("2026-03-15T12:30:00.000Z");
  assert.equal(localDateAt(instant, "Pacific/Kiritimati"), "2026-03-16");
  assert.equal(localDateAt(instant, "Pacific/Honolulu"), "2026-03-15");
});

test("due and missed events use their semantic effective dates", () => {
  assert.equal(dueEventDate("due", "2026-03-15"), "2026-03-15");
  assert.equal(dueEventDate("overdue", "2026-03-15"), "2026-03-16");
  assert.equal(dueEventDate("missed", "2026-03-15", 3), "2026-03-19");
  assert.equal(dueEventDate("missed", "2026-01-31", 0), "2026-02-01");
});

test("deduplication keys are deterministic and tenant-separated", () => {
  const base = {
    eventType: "PROMISE_DUE",
    sourceEntityType: "case_promise",
    sourceEntityId: "CB-1",
    sourceVersion: "4:2026-03-15",
  };
  const first = domainEventDeduplicationKey({ ...base, businessId: "tenant-a" });
  assert.equal(first, domainEventDeduplicationKey({ ...base, businessId: "tenant-a" }));
  assert.notEqual(first, domainEventDeduplicationKey({ ...base, businessId: "tenant-b" }));
});

test("migration detects every required event without message delivery", () => {
  const migration = read("supabase/migrations/20260811_domain_event_scheduler.sql");
  for (const eventType of [
    "FOLLOW_UP_DUE",
    "INVOICE_OVERDUE",
    "PROMISE_DUE",
    "PROMISE_MISSED",
    "PLAN_INSTALLMENT_DUE",
    "PLAN_INSTALLMENT_MISSED",
    "DISPUTE_REVIEW_DUE",
    "PAYMENT_PROOF_REVIEW_REQUIRED",
  ]) {
    assert.match(migration, new RegExp(`'${eventType}'`));
  }
  assert.match(migration, /pg_try_advisory_xact_lock/);
  assert.match(migration, /on conflict \(deduplication_key\) do nothing/);
  assert.match(migration, /timezone\(b\.timezone, v_now\)::date/);
  assert.match(migration, /timezone\(p\.timezone, v_now\)::date/);
  assert.match(migration, /grant execute on function public\.domain_events_detect\(timestamptz\) to service_role/);
  assert.doesNotMatch(migration, /insert into public\.(notifications|action_centre_items|reminders)/);
});

test("tenant RLS is read-only and every candidate derives its tenant from source data", () => {
  const migration = read("supabase/migrations/20260811_domain_event_scheduler.sql");
  const rls = read("src/lib/supabase/rls.sql");
  assert.match(migration, /domain_events: owner read/);
  assert.match(migration, /where b\.id = business_id and b\.owner_id = auth\.uid\(\)/);
  assert.doesNotMatch(rls, /domain_events: owner (insert|update|delete)/);
  assert.match(migration, /join public\.cases c on c\.id = s\.case_id and c\.business_id = s\.business_id/);
  assert.match(migration, /join public\.cases c on c\.id = a\.case_id and c\.business_id = a\.business_id/);
});

test("Vercel cron uses authenticated GET and preserves the legacy plan endpoint", () => {
  const manifest = read("vercel.json");
  const route = read("src/app/api/cron/domain-events/route.ts");
  const legacyRoute = read("src/app/api/cron/payment-plans/route.ts");
  const authorization = read("src/lib/cron/authorization.ts");
  const proxy = read("src/proxy.ts");
  assert.match(manifest, /"path": "\/api\/cron\/domain-events"/);
  assert.match(manifest, /"schedule": "5 \* \* \* \*"/);
  assert.match(route, /export async function GET/);
  assert.match(route, /domain_events_detect/);
  assert.match(route, /authorizeCronRequest/);
  assert.match(legacyRoute, /payment_plan_run_scheduler/);
  assert.match(legacyRoute, /authorizeCronRequest/);
  assert.match(authorization, /timingSafeEqual/);
  assert.match(proxy, /"\/api\/cron"/);
  assert.match(proxy, /const isScheduledJob = pathname\.startsWith\("\/api\/cron\/"\)/);
  assert.match(proxy, /hasServerAuthentication/);
});
