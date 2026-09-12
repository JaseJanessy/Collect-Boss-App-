import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260815_dispute_system.sql");
const schema = read("supabase/schema.sql");
const rls = read("src/lib/supabase/rls.sql");

test("structured dispute categories and lifecycle are complete", () => {
  for (const category of [
    "amount_incorrect", "already_paid", "duplicate_invoice", "goods_not_received",
    "damaged_quality_issue", "service_incomplete", "incorrect_pricing",
    "do_not_recognise_debt", "other",
  ]) assert.match(migration, new RegExp(`'${category}'`));
  for (const status of [
    "submitted", "under_review", "information_requested", "partially_accepted",
    "accepted", "rejected", "resolved", "withdrawn",
  ]) assert.match(migration, new RegExp(`'${status}'`));
  assert.match(schema, /create table if not exists disputes/);
});

test("disputed and undisputed amounts reconcile without erasing the obligation", () => {
  assert.match(migration, /undisputed_amount_minor bigint generated always as\s*\(balance_snapshot_minor-disputed_amount_minor\) stored/);
  assert.match(migration, /disputed_amount_minor > 0 and disputed_amount_minor <= balance_snapshot_minor/);
  assert.doesNotMatch(migration, /delete from public\.(obligations|cases)/);
  assert.doesNotMatch(migration, /update public\.obligations set original_amount_minor/i);
});

test("accepted disputes reuse the financial ledger credit adjustment", () => {
  const transition = migration.slice(migration.indexOf("create or replace function public.dispute_transition"));
  assert.match(transition, /'adjustment_credit'/);
  assert.match(transition, /'dispute_adjustment'/);
  assert.match(transition, /perform public\.financial_recalculate_case/);
  assert.match(transition, /collectboss\.receivables_sync/);
  assert.match(transition, /Partial acceptance requires an amount below the disputed amount/);
  assert.match(transition, /p_to_status in \('rejected','information_requested'\)[\s\S]*A creditor response is required/);
});

test("evidence, events, notifications and review actions remain attached", () => {
  assert.match(migration, /create table if not exists public\.dispute_evidence/);
  assert.match(migration, /on delete restrict/);
  assert.match(migration, /create table if not exists public\.dispute_events/);
  assert.match(migration, /'DISPUTE_SUBMITTED'/);
  assert.match(migration, /insert into public\.action_centre_items/);
  assert.match(migration, /insert into public\.audit_logs/);
  const casePage = read("src/components/pages/case-detail-page.tsx");
  assert.match(casePage, /DisputeCard/);
  assert.match(casePage, /DisputeTimeline/);
});

test("collection messages use only the current undisputed amount", () => {
  const route = read("src/app/api/cases/[caseId]/reminders/route.ts");
  const generator = read("src/lib/reminders/generator.ts");
  assert.match(route, /collectableMinor <= 0[\s\S]*Follow-up is paused/);
  assert.match(route, /dispute_snapshot_minor: disputedMinor/);
  assert.match(route, /The disputed amount changed\. Generate a new reminder/);
  assert.match(generator, /collectableMinor/);
  assert.match(generator, /This reminder concerns only the undisputed amount/);
});

test("debtor flow uses simple language and token-scoped public submission", () => {
  const page = read("src/components/pages/payments/debtor-payment-page.tsx");
  const route = read("src/app/api/public/pay/[token]/dispute/route.ts");
  assert.match(page, /I have an issue with this amount\./);
  assert.match(route, /getPublicActionContext\(token, "payment"\)/);
  assert.match(route, /validateEvidenceUpload/);
  assert.doesNotMatch(route, /getAuthenticatedBusiness/);
  assert.match(migration, /t\.purpose='payment'[\s\S]*t\.expires_at>now\(\)/);
});

test("dispute RLS is tenant-read-only and mutations are RPC controlled", () => {
  for (const policy of ["disputes_owner_read", "dispute_evidence_owner_read", "dispute_events_owner_read"]) {
    assert.match(migration, new RegExp(policy));
    assert.match(rls, new RegExp(policy));
  }
  assert.doesNotMatch(rls, /disputes_owner_(insert|update|delete)/);
  assert.match(migration, /grant execute on function public\.dispute_create_owner/);
  assert.match(migration, /grant execute on function public\.dispute_submit_public[\s\S]*to service_role/);
});
