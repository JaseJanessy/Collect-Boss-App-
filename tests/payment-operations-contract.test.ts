import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migration = readFileSync(resolve("supabase/migrations/20260908_complex_payment_operations.sql"), "utf8");
const schema = readFileSync(resolve("supabase/schema.sql"), "utf8");
const rls = readFileSync(resolve("src/lib/supabase/rls.sql"), "utf8");
const sync = readFileSync(resolve("src/lib/accounting/sync.ts"), "utf8");

test("Prompt 17 migration is mirrored in the canonical schema", () => {
  for (const contract of [
    "create table if not exists public.payment_receipts",
    "create table if not exists public.payment_allocations",
    "create table if not exists public.payment_ledger_entries",
    "create table if not exists public.payment_refunds",
    "create table if not exists public.accounting_payment_operation_outbox",
    "create or replace function public.payment_operation_allocate",
    "create or replace function public.payment_operation_reverse_allocation",
    "create or replace function public.payment_operation_reconciliation",
  ]) {
    assert.match(migration, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(schema, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(schema, /tokens truncated/u);
});

test("allocation is transaction-safe, concurrency-protected and idempotent", () => {
  assert.match(migration, /pg_advisory_xact_lock[\s\S]*:receipt:/u);
  assert.match(migration, /from public\.payment_receipts[\s\S]*for update/u);
  assert.match(migration, /P17_AVAILABLE_AMOUNT_EXCEEDED/u);
  assert.match(migration, /payment_operation_idempotency_keys/u);
  assert.match(migration, /P17_IDEMPOTENCY_CONFLICT/u);
  assert.match(migration, /unique \(reverses_allocation_id\)/u);
});

test("Prompt 16 matched allocations are bridged without duplicating case ledger events", () => {
  assert.match(migration, /payment_operation_capture_matched_allocation/u);
  assert.match(migration, /payment_operation_allocation_id/u);
  assert.match(migration, /v_payment\.financial_event_id/u);
  assert.match(migration, /Backfill Prompt 16 approvals/u);
});

test("consolidated-case invoice projections follow explicit allocation and credit events", () => {
  assert.match(migration, /payment_operation_base_adjustments_minor/u);
  assert.match(migration, /create or replace function public\.receivables_sync_case_obligations/u);
  assert.match(migration, /a\.obligation_id is not null and pr\.receipt_kind='payment'/u);
  assert.match(migration, /P17_CREDIT_EXCEEDS_OBLIGATION/u);
});

test("ledger records are append-only, balanced by currency, and drive case projections", () => {
  assert.match(migration, /P17_APPEND_ONLY/u);
  assert.match(migration, /x\.balance<>0/u);
  assert.match(migration, /P17_UNBALANCED_JOURNAL/u);
  assert.match(migration, /insert into public\.case_financial_events/u);
  assert.match(migration, /financial_recalculate_case/u);
  assert.doesNotMatch(migration, /delete from public\.(payment_receipts|payment_allocations|payment_ledger)/u);
});

test("currency conversion requires an immutable explicit exchange-rate record", () => {
  assert.match(migration, /payment_exchange_rates/u);
  assert.match(migration, /P17_EXCHANGE_RATE_REQUIRED/u);
  assert.match(migration, /P17_SILENT_CURRENCY_CONVERSION/u);
  assert.match(migration, /round\(v_receipt_amount::numeric\*v_rate\.numerator\/v_rate\.denominator\)/u);
});

test("reversals retain actor, reason, original allocation and opposite ledger event", () => {
  assert.match(migration, /reverses_allocation_id/u);
  assert.match(migration, /P17_REASON_REQUIRED/u);
  assert.match(migration, /'payment_reversal' else 'adjustment_debit'/u);
  assert.match(migration, /'payment\.allocation_reversed'/u);
});

test("RLS denies anonymous writes and sensitive RPCs are service-only", () => {
  assert.match(rls, /payment_receipts_read[\s\S]*has_business_permission/u);
  assert.match(rls, /revoke all on public\.payment_operation_idempotency_keys from authenticated/u);
  assert.match(rls, /revoke all on function public\.payment_operation_allocate[\s\S]*authenticated/u);
  assert.match(rls, /grant execute on function public\.payment_operation_allocate[\s\S]*to service_role/u);
});

test("accounting failures are isolated in a retryable idempotent outbox", () => {
  assert.match(migration, /status text not null default 'pending'/u);
  assert.match(migration, /unique \(connection_id,idempotency_key\)/u);
  assert.match(sync, /\.in\("status", \["pending", "failed"\]\)/u);
  assert.match(sync, /status: "processing"/u);
  assert.match(sync, /status: "synced"/u);
  assert.match(sync, /const deadLetter = !configurationRequired && claimed\.attempts >= 8/u);
  assert.match(sync, /configurationRequired \? "configuration_required" : deadLetter \? "dead_letter" : "failed"/u);
  assert.match(sync, /next_attempt_at: retryAt/u);
});

test("accounting writeback replay is tenant-bound, reasoned, and audited", () => {
  const retryRoute = readFileSync(resolve("src/app/api/payment-operations/accounting-outbox/[outboxId]/retry/route.ts"), "utf8");
  assert.match(retryRoute, /requireTenantPermission\("payment\.approve"\)/u);
  assert.match(retryRoute, /reason: z\.string\(\)\.trim\(\)\.min\(10\)\.max\(500\)/u);
  assert.match(retryRoute, /\.eq\("business_id", access\.businessId\)/u);
  assert.match(retryRoute, /\["failed", "configuration_required", "dead_letter"\]/u);
  assert.match(retryRoute, /action: "accounting\.writeback_replayed"/u);
});
