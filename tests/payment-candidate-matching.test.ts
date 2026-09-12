import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260907_automatic_payment_candidate_matching.sql");
const schema = read("supabase/schema.sql");
const rls = read("src/lib/supabase/rls.sql");
const imports = read("src/app/api/payment-matching/transactions/route.ts");
const match = read("src/app/api/payment-matching/transactions/[transactionId]/match/route.ts");
const review = read("src/app/api/payment-matching/transactions/[transactionId]/review/route.ts");
const settings = read("src/app/api/payment-matching/settings/route.ts");
const engine = read("src/lib/payment-matching/engine.ts");

test("normalized transactions preserve source IDs, batches, proof lineage, and duplicate signals", () => {
  for (const table of ["normalized_payment_transactions", "payment_match_jobs", "payment_match_candidates", "payment_match_candidate_events", "payment_match_allocations"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`, "iu"));
    assert.match(schema, new RegExp(`create table if not exists public\\.${table}`, "iu"));
  }
  assert.match(migration, /unique\(business_id,source_type,source_system,source_record_id\)/iu);
  assert.match(migration, /source_batch_key text/iu);
  assert.match(migration, /import_batch_id uuid references public\.import_batches/iu);
  assert.match(migration, /duplicate_signals jsonb/iu);
  assert.match(migration, /payment_matching_document_outcome_capture/iu);
  assert.match(migration, /payment_matching_public_proof_capture/iu);
});

test("imports and matching jobs are idempotent, tenant-scoped, and rate limited by the shared proxy", () => {
  assert.match(imports, /readIdempotencyKey\(request\.headers\)/u);
  assert.match(match, /readIdempotencyKey\(request\.headers\)/u);
  assert.match(migration, /unique\(business_id,action_scope,idempotency_key\)/iu);
  assert.match(migration, /P16_IDEMPOTENCY_CONFLICT/u);
  assert.match(imports, /requireDocumentPermission\(request, "payment\.approve"\)/u);
  assert.match(match, /requireDocumentPermission\(request, "payment\.approve"\)/u);
  assert.match(review, /requireDocumentPermission\(request, "payment\.approve"\)/u);
  assert.match(read("src/proxy.ts"), /const limit = isPublicCapability \? 20 : 240/u);
});

test("amount equality alone cannot reach review and every candidate keeps explanations", () => {
  assert.match(engine, /amount_outstanding_exact[\s\S]*20/u);
  assert.match(engine, /currency_exact[\s\S]*15/u);
  assert.match(engine, /ambiguous: 45/u);
  for (const field of ["matched_signals", "conflicting_signals", "reason", "ranking_reason"]) assert.match(migration, new RegExp(field));
  assert.doesNotMatch([engine, migration, imports, match, review].join("\n"), /\bfraud\b/iu);
});

test("review history is append-only and one transaction cannot be approved twice", () => {
  assert.match(migration, /payment_match_candidate_events_append_only before update or delete/iu);
  assert.match(migration, /payment_match_allocations_one_unsplit_idx[\s\S]*\(transaction_id\) where split_group_id is null/iu);
  assert.match(migration, /exists\(select 1 from public\.payment_match_allocations where transaction_id=p_transaction_id\)/iu);
  assert.match(migration, /t\.id=v_transaction\.duplicate_of_transaction_id or t\.duplicate_of_transaction_id=p_transaction_id/iu);
  assert.match(migration, /P16_TRANSACTION_ALREADY_ALLOCATED/u);
  assert.match(migration, /p_split_authorization[\s\S]*jsonb_array_length\(p_allocations\)<2/iu);
  assert.match(migration, /v_total<>v_transaction\.amount_minor/iu);
  for (const decision of ["approve", "reject", "defer"]) assert.match(review, new RegExp(decision));
});

test("tenant thresholds stay inside safe bounds and changes are audited", () => {
  assert.match(migration, /high_confidence_threshold between 70 and 95/iu);
  assert.match(migration, /ambiguous_threshold between 30 and 69/iu);
  assert.match(migration, /date_window_days between 1 and 30/iu);
  assert.match(settings, /appendSensitiveAudit/iu);
  assert.match(settings, /payment_matching\.settings_updated/u);
});

test("RLS permits tenant payment reviewers to read but keeps writes service-only", () => {
  for (const table of ["normalized_payment_transactions", "payment_match_jobs", "payment_match_candidates", "payment_match_candidate_events", "payment_match_allocations"]) {
    assert.match(rls, new RegExp(`alter table public\\.${table} enable row level security`, "iu"));
    assert.match(rls, new RegExp(`${table}[^;]+has_business_permission\\(business_id,'payment\\.approve'\\)`, "isu"));
  }
  assert.match(migration, /revoke all on function public\.payment_matching_review_candidate[^;]+from public,anon,authenticated/iu);
  assert.match(migration, /grant execute on function public\.payment_matching_review_candidate[^;]+to service_role/iu);
});

test("new accounting payments enter matching instead of the legacy auto-post path", () => {
  const sync = read("src/lib/accounting/sync.ts");
  assert.match(sync, /paymentRecords = applicableRecords\.filter\(\(record\) => record\.kind === "payment"\)/u);
  assert.match(sync, /legacyRecords = applicableRecords\.filter\(\(record\) => record\.kind !== "payment"\)/u);
  assert.match(sync, /payment_matching_import_transactions/u);
  assert.match(sync, /missing its source currency; no candidate was created/u);
});
