import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  allocateCasePaymentsFifo,
  calculateCanonicalCustomerTotals,
  obligationBalance,
  reconcileCoveredCase,
} from "../src/lib/receivables/calculations.ts";

const read = (path: string) => readFileSync(path, "utf8");

test("one customer can hold multiple accounts and obligations without counting covered cases twice", () => {
  const obligations = [
    { id: "invoice-1", accountId: "rental", originalAmountMinor: 10_000, adjustmentsMinor: 500, paidMinor: 2_000 },
    { id: "invoice-2", accountId: "project", originalAmountMinor: 5_000, adjustmentsMinor: -500, paidMinor: 1_000 },
  ];
  const cases = [
    { id: "covered", accountId: "rental", scope: "single_obligation" as const, contractualDueMinor: 10_500, approvedPaymentMinor: 2_000, outstandingMinor: 8_500 },
    { id: "legacy", accountId: null, scope: "standalone" as const, contractualDueMinor: 3_000, approvedPaymentMinor: 500, outstandingMinor: 2_500 },
  ];
  assert.deepEqual(calculateCanonicalCustomerTotals(obligations, cases), {
    contractualDueMinor: 18_000,
    paidMinor: 3_500,
    outstandingMinor: 14_500,
  });
});

test("one case covers multiple invoices and ledger payments allocate FIFO", () => {
  const obligations = [
    { id: "oldest", accountId: "account", originalAmountMinor: 4_000, adjustmentsMinor: 0, paidMinor: 0 },
    { id: "newest", accountId: "account", originalAmountMinor: 6_000, adjustmentsMinor: 0, paidMinor: 0 },
  ];
  const allocation = allocateCasePaymentsFifo(obligations, 7_000);
  assert.deepEqual([...allocation], [["oldest", 4_000], ["newest", 3_000]]);
  const projected = obligations.map((item) => ({ ...item, paidMinor: allocation.get(item.id) ?? 0 }));
  assert.equal(reconcileCoveredCase({
    id: "case", accountId: "account", scope: "multiple_obligations",
    contractualDueMinor: 10_000, approvedPaymentMinor: 7_000, outstandingMinor: 3_000,
  }, projected).reconciled, true);
});

test("obligation arithmetic labels adjustments independently from payments", () => {
  assert.deepEqual(obligationBalance({
    originalAmountMinor: 10_000,
    adjustmentsMinor: -1_500,
    paidMinor: 2_000,
  }), { contractualDueMinor: 8_500, paidMinor: 2_000, outstandingMinor: 6_500 });
  assert.throws(() => obligationBalance({ originalAmountMinor: 100, adjustmentsMinor: -200, paidMinor: 0 }));
});

test("migration provides controlled metadata, relationships, indexes and double-counting controls", () => {
  const migration = read("supabase/migrations/20260809_receivables_foundation.sql");
  for (const table of ["customer_accounts", "obligations", "recovery_case_obligations"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  for (const accountType of ["general", "corporate", "supplier", "rental", "vehicle", "property", "project", "catering_event", "future"]) {
    assert.match(migration, new RegExp(`'${accountType}'`));
  }
  assert.match(migration, /metadata jsonb not null default '\{\}'::jsonb/);
  assert.match(migration, /custom_fields jsonb not null default '\{\}'::jsonb/);
  assert.match(migration, /unique \(obligation_id\)/);
  assert.match(migration, /foreign key \(account_id, business_id, customer_id\)/);
  assert.match(migration, /foreign key \(case_id, business_id\)/);
  assert.match(migration, /receivables_sync_case_obligations/);
  assert.match(migration, /rows between unbounded preceding and 1 preceding/);
  assert.match(migration, /security_invoker = true/);
});

test("legacy cases remain standalone and new relationship writes are tenant-gated", () => {
  const migration = read("supabase/migrations/20260809_receivables_foundation.sql");
  const schema = read("supabase/schema.sql");
  const rls = read("src/lib/supabase/rls.sql");
  const customerApi = read("src/app/api/debtors/[debtorId]/receivables/route.ts");
  const caseApi = read("src/app/api/cases/[caseId]/receivables/route.ts");
  assert.match(migration, /case_scope text not null default 'standalone'/);
  assert.match(schema, /account_id\s+uuid/);
  assert.match(schema, /case_scope\s+text not null default 'standalone'/);
  assert.match(rls, /recovery_case_obligations: owner read/);
  assert.doesNotMatch(rls, /recovery_case_obligations: owner insert/);
  for (const api of [customerApi, caseApi]) {
    assert.match(api, /getAuthenticatedBusiness/);
    assert.match(api, /\.eq\("business_id", found\.businessId\)/);
    assert.match(api, /params: Promise/);
  }
});
