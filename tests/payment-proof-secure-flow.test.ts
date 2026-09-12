import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migration = read("supabase/migrations/20260806_secure_payment_proof_flow.sql");
const publicRoute = read("src/app/api/public/pay/[token]/proof/route.ts");
const reviewRoute = read("src/app/api/payment-submissions/[id]/review/route.ts");

test("debtor proof is linked to tenant, case, debtor, invoice and receiving account", () => {
  for (const column of ["business_id", "case_id", "debtor_id", "receiving_account_id", "invoice_reference"]) {
    assert.match(migration, new RegExp(`add column if not exists ${column}`));
  }
  assert.match(migration, /new\.business_id := current_case\.business_id/);
  assert.match(migration, /new\.receiving_account_id := access_token\.receiving_account_id/);
});

test("receipt, idempotency, and immutable source controls protect confirmation", () => {
  assert.match(publicRoute, /Attach Payment Proof as a PDF, JPG, or PNG file/);
  assert.match(publicRoute, /idempotency_key: idempotencyKey/);
  assert.match(publicRoute, /proof_object_path: proofObjectPath/);
  assert.doesNotMatch(publicRoute, /from\("public_payment_submissions"\)\.delete/);
  assert.match(migration, /payment reference has already been submitted/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /source_submission_id = submission\.id/);
  assert.match(migration, /if old_status in \('confirmed','approved'\)/);
  assert.match(migration, /financial_create_owner_payment\(/);
  assert.doesNotMatch(migration, /'public_payment_submissions', submission\.id, 'Approved public payment proof'/);
});

test("proof lifecycle requires reasons and produces action, notification, timeline, and audit rows", () => {
  for (const status of ["submitted", "under_review", "confirmed", "rejected", "more_information_required"]) {
    assert.match(migration, new RegExp(`'${status}'`));
  }
  assert.match(reviewRoute, /Enter a reason of at least 3 characters/);
  assert.match(migration, /insert into public\.payment_proof_events/);
  assert.match(migration, /insert into public\.notifications/);
  assert.match(migration, /insert into public\.action_centre_items/);
  assert.match(migration, /insert into public\.audit_logs/);
});

test("tenant RLS scopes every Y02 creditor-facing table", () => {
  for (const table of ["public_payment_submissions", "payment_proof_events", "notifications", "action_centre_items"]) {
    assert.match(migration, new RegExp(`create policy "${table === "public_payment_submissions" ? "public_payment_submissions_owner_read" : `${table}_owner_read`}"`));
  }
  assert.match(migration, /b\.owner_id = auth\.uid\(\)/);
  assert.doesNotMatch(migration, /to anon/);
});
