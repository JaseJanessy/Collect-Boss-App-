import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260919_pocket_to_solo_upgrade_release_gate.sql");
const schema = read("supabase/schema.sql");
const rls = read("src/lib/supabase/rls.sql");
const checkout = read("src/app/api/pocket/upgrade/checkout/route.ts");
const stripeEvents = read("src/lib/billing/stripe-events.ts");

test("Pocket-to-Solo migration is staged, owner-only, and exactly once", () => {
  assert.match(migration, /pocket_solo_upgrade_runs/);
  assert.match(migration, /pocket_solo_upgrade_items/);
  assert.match(migration, /pocket_solo_upgrade_one_active_business_idx/);
  assert.match(migration, /unique\(run_id,obligation_id\)/);
  assert.match(migration, /on conflict\(obligation_id\) do nothing/);
  assert.match(migration, /POCKET_UPGRADE_OWNER_REQUIRED/);
  assert.match(migration, /POCKET_UPGRADE_SINGLE_USER_REQUIRED/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /POCKET_UPGRADE_IDEMPOTENCY_CONFLICT/);
  assert.doesNotMatch(migration, /insert into public\.obligations/i);
  assert.doesNotMatch(migration, /insert into public\.payment_allocations/i);
});

test("all source balances validate before any projection write and product switch is last", () => {
  const validation = migration.indexOf("Validate every source snapshot");
  const caseInsert = migration.indexOf("insert into public.cases");
  const linkInsert = migration.indexOf("insert into public.recovery_case_obligations");
  const switchProduct = migration.indexOf("update public.workspace_product_states set product_type='main'");
  const completion = migration.indexOf("status='completed'", switchProduct);
  assert.ok(validation > 0 && validation < caseInsert);
  assert.ok(caseInsert < linkInsert && linkInsert < switchProduct && switchProduct < completion);
  assert.match(migration, /POCKET_UPGRADE_SOURCE_CHANGED/);
  assert.match(migration, /POCKET_UPGRADE_FINANCIAL_MISMATCH/);
  assert.match(migration, /receivables_sync_case_obligations/);
  assert.match(migration, /'reconciled',v_due-v_paid=v_outstanding/);
});

test("review states are explicit and checkout is blocked until refreshed", () => {
  for (const disposition of [
    "migrate_active", "migrate_settled", "preserve_cancelled",
    "review_disputed", "review_ambiguous", "review_malformed",
  ]) assert.match(migration, new RegExp(disposition));
  assert.match(migration, /POCKET_UPGRADE_REVIEW_REQUIRED/);
  assert.match(migration, /REVIEW_REFRESHED/);
  assert.match(read("src/components/pocket/pocket-upgrade-panel.tsx"), /Refresh review/);
});

test("Solo checkout uses server configuration and verified webhook metadata", () => {
  assert.match(checkout, /requirePocketBillingAccess\("billing\.manage"\)/);
  assert.match(checkout, /getPriceId\("starter"\)/);
  assert.match(checkout, /Idempotency-Key/);
  assert.match(checkout, /upgrade_kind: "pocket_to_solo"/);
  assert.match(checkout, /upgrade_run_id: prepared\.runId/);
  assert.doesNotMatch(checkout, /await request\.json/);
  assert.match(stripeEvents, /completePocketSoloUpgrade/);
  assert.match(stripeEvents, /commitPocketSoloUpgrade/);
  assert.match(stripeEvents, /stripe\.subscriptions\.cancel/);
  assert.match(stripeEvents, /markPocketSoloCleanup/);
  assert.match(stripeEvents, /pocket_to_solo_upgrade_completed/);
});

test("migration provenance is tenant-readable, service-written, and schema-consistent", () => {
  for (const source of [migration, schema, rls]) {
    assert.match(source, /pocket_solo_upgrade_runs_owner_read/);
    assert.match(source, /pocket_solo_upgrade_items_owner_read/);
    assert.match(source, /has_business_permission\(business_id,'billing\.manage'\)/);
    assert.match(source, /grant all on public\.pocket_solo_upgrade_runs,public\.pocket_solo_upgrade_items to service_role/);
  }
  assert.match(migration, /revoke all on function public\.pocket_commit_solo_upgrade.*authenticated/);
  assert.doesNotMatch(rls, /grant (insert|update|delete).*pocket_solo_upgrade.*authenticated/i);
});

test("retained Pocket history is projected into Main timeline and export without copying", () => {
  const timeline = read("src/lib/timeline/server.ts");
  const exportSource = read("src/lib/exports/business-data.ts");
  for (const table of ["payment_allocations", "pocket_reminder_events", "pocket_receipt_payment_links", "pocket_simple_invoices"]) {
    assert.match(timeline, new RegExp(table));
    assert.match(exportSource, new RegExp(table));
  }
  assert.match(exportSource, /pocket_allocation_event/);
  assert.match(exportSource, /pocket_simple_invoice_item/);
});

test("release documentation forbids downgrade and does not overclaim readiness", () => {
  const runbook = read("docs/POCKET_TO_SOLO_MIGRATION.md");
  const gate = read("docs/POCKET_V1_RELEASE_GATE.md");
  assert.match(runbook, /downgrade is explicitly unsupported/i);
  assert.match(runbook, /No item above is marked complete/);
  assert.match(gate, /Current decision: \*\*FAIL/);
  assert.equal((gate.match(/\| NOT RUN \|/g) ?? []).length, 8);
  assert.match(gate, /scope-frozen/);
});
