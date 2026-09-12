import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260909_debt_truth_engine.sql");
const schema = read("supabase/schema.sql");
const rls = read("src/lib/supabase/rls.sql");
const route = read("src/app/api/cases/[caseId]/debt-truth/route.ts");
const engine = read("src/lib/debt-truth/engine.ts");

test("canonical debt components are integer minor-unit projections", () => {
  for (const component of [
    "original_principal_minor", "invoiced_amount_minor", "approved_adjustments_minor",
    "approved_fees_minor", "credit_notes_minor", "confirmed_payments_minor",
    "disputed_amount_minor", "unverified_amount_minor", "confirmed_outstanding_minor",
    "total_displayed_exposure_minor",
  ]) assert.match(migration, new RegExp(`${component} bigint`, "i"));
  assert.doesNotMatch(engine, /parseFloat|toFixed|Math\.round/);
  assert.match(engine, /MinorUnits/);
});

test("only approved facts enter confirmed debt and unverified payments never reduce it", () => {
  assert.match(engine, /approvalStatus === "approved"/);
  assert.match(engine, /approvalStatus === "pending"/);
  assert.match(engine, /unverifiedCredits[\s\S]*"payment"/);
  assert.match(engine, /totalDisplayedExposureMinor = confirmedOutstandingMinor \+ disputedAmountMinor \+ unverifiedAmountMinor/);
});

test("fees, interest, write-offs, and manual adjustments require explicit authority", () => {
  assert.match(migration, /DEBT_TRUTH_FEE_AUTHORITY_REQUIRED/);
  assert.match(migration, /DEBT_TRUTH_WRITE_OFF_AUTHORITY_REQUIRED/);
  assert.match(migration, /DEBT_TRUTH_ADJUSTMENT_AUTHORITY_REQUIRED/);
  assert.match(migration, /DEBT_TRUTH_INDEPENDENT_APPROVAL_REQUIRED/);
});

test("versions and reversals preserve immutable history", () => {
  assert.match(migration, /source_fingerprint char\(64\)/i);
  assert.match(migration, /unique\(case_id,version\)/i);
  assert.match(migration, /DEBT_TRUTH_APPEND_ONLY/);
  assert.match(migration, /reverses_event_id/);
  assert.doesNotMatch(migration.match(/create or replace function public\.debt_truth_recalculate_case[\s\S]*?create or replace function public\.debt_truth_after_event/i)?.[0] ?? "", /delete from public\.debt_/i);
});

test("legacy cases reconcile with exception reporting and a history-preserving rollback", () => {
  assert.match(migration, /Legacy case opening principal/);
  assert.match(migration, /debt_ledger_reconciliation_exceptions/);
  assert.match(migration, /legacy_balance_mismatch/);
  assert.match(migration, /Rollback \(history-preserving\)/i);
});

test("tenant API validates inputs, scopes every query, and returns structured errors", () => {
  assert.match(route, /getAuthenticatedBusiness\("case\.read"\)/);
  assert.match(route, /\.eq\("business_id", auth\.businessId\)/);
  assert.match(route, /INVALID_CASE_ID/);
  assert.match(route, /INVALID_QUERY/);
  assert.match(route, /error: \{ code, message \}/);
  assert.match(route, /String\(copy\[field\]\)/);
  assert.match(migration, /debt_balance_versions_api with \(security_invoker=true\)[\s\S]*original_principal_minor::text/i);
  assert.match(route, /from\("debt_balance_versions_api"\)/);
  assert.match(route, /private, no-store/);
});

test("schema and RLS sources declare the same tenant read/service write boundary", () => {
  for (const source of [schema, rls]) {
    assert.match(source, /debt_ledger_events_tenant_read/);
    assert.match(source, /debt_balance_versions_tenant_read/);
    assert.match(source, /debt_reconciliation_exceptions_audit_read/);
  }
  assert.match(rls, /grant all on public\.debt_ledger_events[\s\S]*to service_role/i);
  assert.doesNotMatch(rls, /debt_ledger_events[\s\S]{0,120}for (insert|update|delete) to authenticated/i);
});
