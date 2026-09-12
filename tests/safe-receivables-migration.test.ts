import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeLegacyCaseRow,
  type LegacyCompatibleCaseRow,
} from "../src/lib/receivables/legacy-normalization.ts";

const read = (path: string) => readFileSync(path, "utf8");

function legacyCase(overrides: Record<string, unknown> = {}) {
  return {
    id: "CB-legacy",
    business_id: "business",
    debtor_id: null,
    debtor_type: "individual",
    debtor_name: "Legacy Customer",
    debtor_phone: null,
    debtor_email: null,
    debtor_company: null,
    debtor_reg_no: null,
    debtor_location: null,
    amount_owed: 100,
    amount_paid: 40,
    balance: 60,
    financial_version: 1,
    due_date: "2026-01-01",
    invoice_no: null,
    status: "partial_paid",
    promise_due_date: null,
    closed_at: null,
    closed_by: null,
    close_reason: null,
    archived_at: null,
    archived_by: null,
    archive_reason: null,
    status_version: 1,
    next_best_action: null,
    payment_lock_mode: "approval",
    receiving_account_id: null,
    days_overdue: 0,
    notes: null,
    bank: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as unknown as LegacyCompatibleCaseRow;
}

test("legacy partial payment rows normalize without changing decimal balances", () => {
  const normalized = normalizeLegacyCaseRow(legacyCase());
  assert.equal(normalized.account_id, null);
  assert.equal(normalized.case_scope, "standalone");
  assert.equal(normalized.original_principal_minor, 10_000);
  assert.equal(normalized.contractual_due_minor, 10_000);
  assert.equal(normalized.approved_payment_minor, 4_000);
  assert.equal(normalized.outstanding_minor, 6_000);
  assert.equal(normalized.overpayment_minor, 0);
  assert.equal(normalized.debtor_id, null);
});

test("modern ledger values remain authoritative for adjusted and overpaid cases", () => {
  const normalized = normalizeLegacyCaseRow(legacyCase({
    account_id: "account",
    case_scope: "single_obligation",
    original_principal_minor: 10_000,
    contractual_due_minor: 11_500,
    approved_payment_minor: 12_000,
    outstanding_minor: 0,
    overpayment_minor: 500,
  }));
  assert.equal(normalized.contractual_due_minor, 11_500);
  assert.equal(normalized.approved_payment_minor, 12_000);
  assert.equal(normalized.outstanding_minor, 0);
  assert.equal(normalized.overpayment_minor, 500);
  assert.equal(normalized.case_scope, "single_obligation");
});

test("closed and zero-balance legacy cases remain closed and settled", () => {
  const normalized = normalizeLegacyCaseRow(legacyCase({
    amount_paid: 100,
    balance: 0,
    status: "closed",
    closed_at: "2026-02-01T00:00:00.000Z",
    closed_by: "owner",
    close_reason: "settled",
  }));
  assert.equal(normalized.status, "closed");
  assert.equal(normalized.outstanding_minor, 0);
  assert.equal(normalized.approved_payment_minor, 10_000);
});

test("safe migration snapshots counts, totals and relationship attachments", () => {
  const migration = read("supabase/migrations/20260810_safe_receivables_backfill.sql");
  for (const count of [
    "customers", "cases", "payments", "payment_plans", "reminders",
    "evidence", "legal_documents", "lawyer_handoffs", "payment_proofs",
    "statement_financial_events",
  ]) {
    assert.match(migration, new RegExp(`'${count}'`));
  }
  for (const mapping of [
    "case_customer_map", "payment_case_map", "plan_case_map",
    "reminder_case_map", "evidence_case_map", "statement_source_case_map",
    "lawyer_handoff_case_map",
  ]) {
    assert.match(migration, new RegExp(`'${mapping}'`));
  }
  for (const scenario of [
    "partial_payment_cases", "closed_cases", "zero_balance_cases",
    "cases_with_plans", "incomplete_customer_links",
  ]) {
    assert.match(migration, new RegExp(`'${scenario}'`));
  }
  assert.match(migration, /counts_unchanged/);
  assert.match(migration, /financials_unchanged/);
  assert.match(migration, /relationships_unchanged/);
  assert.match(migration, /scenario_cohorts_unchanged/);
  assert.match(migration, /legacy counts or financial totals changed/);
});

test("General Account backfill is additive, balance-neutral and rerunnable", () => {
  const migration = read("supabase/migrations/20260810_safe_receivables_backfill.sql");
  const foundation = read("supabase/migrations/20260809_receivables_foundation.sql");
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /set local lock_timeout = '5s'/);
  assert.match(migration, /alter table public\.cases validate constraint cases_customer_tenant_fk/);
  assert.match(foundation, /cases_customer_tenant_fk[\s\S]*?not valid/);
  assert.match(migration, /on conflict \(migration_key, business_id\) do nothing/);
  assert.match(migration, /and not mv\.verified/);
  assert.match(migration, /and not v\.verified/);
  assert.match(migration, /c\.created_at <= mv\.started_at/);
  assert.match(migration, /insert into public\.customer_accounts/);
  assert.match(migration, /'General Account'/);
  assert.match(migration, /not exists \(\s*select 1 from public\.customer_accounts/);
  assert.match(migration, /customer_accounts_legacy_general_unique/);
  assert.doesNotMatch(migration, /insert into public\.obligations/);
  assert.doesNotMatch(migration, /update public\.cases/);
  assert.doesNotMatch(migration, /delete from public\.(debtors|cases|payments|payment_plans|reminders|evidence_files|lawyer_referrals)/);
});

test("compatibility surfaces are typed, tenant-scoped and used by legacy case routes", () => {
  const migration = read("supabase/migrations/20260810_safe_receivables_backfill.sql");
  const schema = read("supabase/schema.sql");
  const rls = read("src/lib/supabase/rls.sql");
  const types = read("src/lib/supabase/types.ts");
  const listRoute = read("src/app/api/cases/route.ts");
  const detailRoute = read("src/app/api/cases/[caseId]/route.ts");
  assert.match(migration, /legacy_case_receivables_compatibility/);
  assert.match(migration, /with \(security_invoker = true\)/);
  assert.match(schema, /create table if not exists receivables_migration_verifications/);
  assert.match(schema, /create or replace view legacy_case_receivables_compatibility/);
  assert.match(rls, /receivables_migration_verifications: owner read/);
  assert.doesNotMatch(rls, /receivables_migration_verifications: owner (insert|update|delete)/);
  assert.match(types, /ReceivablesMigrationVerificationRow/);
  assert.match(types, /LegacyCaseReceivablesCompatibilityRow/);
  for (const route of [listRoute, detailRoute]) {
    assert.match(route, /normalizeLegacyCaseRow/);
    assert.match(route, /getAuthenticatedBusiness/);
  }
});
