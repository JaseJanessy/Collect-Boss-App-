import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260824_bulk_operations_search_import_merge.sql");
const schema = read("supabase/schema.sql");
const rls = read("src/lib/supabase/rls.sql");

test("R16 search covers operational identifiers, metadata and indexed tenant filters", () => {
  for (const value of [
    "debtor_name", "debtor_phone", "debtor_email", "invoice_no", "purchase_order_reference",
    "account_number", "metadata::text", "payment_promises", "payment_plans", "disputes",
    "next_follow_up_at", "priority", "assigned_to",
  ]) assert.match(migration, new RegExp(value));
  assert.match(migration, /create extension if not exists pg_trgm/i);
  assert.match(migration, /gin_trgm_ops/i);
  assert.match(migration, /operational_case_search[\s\S]*has_business_permission\(p_business_id,'case\.read'\)/i);
  assert.match(schema, /create table if not exists public\.import_batches/i);
});

test("import uses mapping, dry-run errors and one transactional commit RPC", () => {
  const route = read("src/app/api/operations/import/route.ts");
  const parser = read("src/lib/imports/operational-import.ts");
  assert.match(route, /action === "preview"/);
  assert.match(route, /validateImport/);
  assert.match(route, /import_errors/);
  assert.match(route, /commit_operational_import/);
  assert.match(parser, /CSV or XLSX/i);
  assert.match(parser, /5,000 data rows/i);
  assert.match(parser, /AMBIGUOUS_DUPLICATE/);
  assert.match(migration, /jsonb_array_length\(p_rows\)>5000/i);
  assert.match(migration, /insert into public\.obligations[\s\S]*insert into public\.cases[\s\S]*insert into public\.recovery_case_obligations/i);
  assert.doesNotMatch(migration, /insert into public\.payments/i);
});

test("duplicate matches require confirmation and merge preserves linked financial records", () => {
  const route = read("src/app/api/operations/duplicates/route.ts");
  assert.match(route, /confirmation: z\.literal\("MERGE"\)/);
  assert.match(migration, /merge_duplicate_debtors/);
  for (const table of [
    "customer_accounts", "obligations", "cases", "payment_promises", "disputes",
    "payment_negotiations", "communication_activities", "contact_guard_overrides",
  ]) assert.match(migration, new RegExp(`update public\\.${table}`));
  assert.match(migration, /'customer\.merged'/);
  assert.doesNotMatch(migration, /delete from public\.(cases|payments|case_financial_events|legal_documents)/i);
  assert.doesNotMatch(migration, /update public\.payments/i);
});

test("bulk actions are tenant-scoped, audited and messaging reuses contact guardrails", () => {
  const bulk = read("src/app/api/operations/bulk/route.ts");
  const reminders = read("src/app/api/operations/bulk-reminders/route.ts");
  const delivery = read("src/lib/communications/reminder-delivery.ts");
  assert.match(migration, /bulk_update_cases[\s\S]*has_business_permission\(p_business_id,'case\.manage'\)/i);
  assert.match(migration, /'cases\.bulk_'\|\|p_action/i);
  assert.match(bulk, /appendSensitiveAudit/);
  assert.match(reminders, /loadContactGuardContexts/);
  assert.match(reminders, /bulk_allowed/);
  assert.match(delivery, /REMINDER_EMAIL_FROM/);
  assert.match(reminders, /status: "failed"/);
});

test("import reports are tenant-readable and remain server-write-only", () => {
  for (const policy of ["import_batches_role_read", "import_errors_role_read"]) {
    assert.match(migration, new RegExp(policy));
    assert.match(rls, new RegExp(policy));
  }
  assert.doesNotMatch(rls, /import_(batches|errors).+for (insert|update|delete)/i);
  assert.match(migration, /grant all on public\.import_batches,public\.import_errors to service_role/i);
});
