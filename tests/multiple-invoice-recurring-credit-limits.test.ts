import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  calculateAccountRollForward,
  calculateCanonicalCustomerTotals,
  calculateCreditLimitSnapshot,
} from "../src/lib/receivables/calculations.ts";

const read = (path: string) => readFileSync(path, "utf8");

test("ongoing accounts roll forward from invoice detail without storing a second balance", () => {
  const firstCycle = [
    { id: "inv-1", accountId: "ongoing", originalAmountMinor: 10_000, adjustmentsMinor: 0, paidMinor: 2_000 },
    { id: "inv-2", accountId: "ongoing", originalAmountMinor: 5_000, adjustmentsMinor: -500, paidMinor: 0 },
  ];
  assert.deepEqual(calculateAccountRollForward(firstCycle, "ongoing"), {
    contractualDueMinor: 14_500,
    paidMinor: 2_000,
    outstandingMinor: 12_500,
  });

  const nextCycle = [
    ...firstCycle,
    { id: "inv-3", accountId: "ongoing", originalAmountMinor: 3_000, adjustmentsMinor: 0, paidMinor: 0 },
  ];
  assert.deepEqual(calculateAccountRollForward(nextCycle, "ongoing"), {
    contractualDueMinor: 17_500,
    paidMinor: 2_000,
    outstandingMinor: 15_500,
  });
});

test("invoice-led account cases never add a duplicate account balance", () => {
  const obligations = [
    { id: "inv-1", accountId: "ongoing", originalAmountMinor: 10_000, adjustmentsMinor: 0, paidMinor: 2_000 },
    { id: "inv-2", accountId: "ongoing", originalAmountMinor: 5_000, adjustmentsMinor: 0, paidMinor: 0 },
  ];
  const accountRecoveryCase = [{
    id: "case",
    accountId: "ongoing",
    scope: "multiple_obligations" as const,
    contractualDueMinor: 15_000,
    approvedPaymentMinor: 2_000,
    outstandingMinor: 13_000,
  }];
  assert.deepEqual(calculateCanonicalCustomerTotals(obligations, accountRecoveryCase), {
    contractualDueMinor: 15_000,
    paidMinor: 2_000,
    outstandingMinor: 13_000,
  });
});

test("credit utilization and transparent warning thresholds are exact", () => {
  assert.deepEqual(calculateCreditLimitSnapshot(8_000, 10_000, 80), {
    currentExposureMinor: 8_000,
    availableCreditMinor: 2_000,
    utilizationPercentage: 80,
    warning: "approaching_limit",
  });
  assert.equal(calculateCreditLimitSnapshot(10_000, 10_000).warning, "limit_reached");
  assert.deepEqual(calculateCreditLimitSnapshot(12_500, 10_000), {
    currentExposureMinor: 12_500,
    availableCreditMinor: -2_500,
    utilizationPercentage: 125,
    warning: "over_limit",
  });
  assert.equal(calculateCreditLimitSnapshot(100, null).warning, "no_limit");
});

test("R17 migration is additive, advisory by default and tenant-safe", () => {
  const migration = read("supabase/migrations/20260823_multiple_invoice_recurring_accounts.sql");
  const schema = read("supabase/schema.sql");
  const rls = read("src/lib/supabase/rls.sql");

  for (const sql of [migration, schema]) {
    assert.match(sql, /account_mode[\s\S]*?'one_off'[\s\S]*?'ongoing'/);
    assert.match(sql, /credit_limit_minor bigint/);
    assert.match(sql, /credit_warning_threshold_percent/);
    assert.match(sql, /credit_limit_enforcement_enabled boolean not null default false/);
    assert.match(sql, /create or replace view (public\.)?account_receivable_totals[\s\S]*?security_invoker = true/);
    assert.match(sql, /current_exposure_minor/);
    assert.match(sql, /available_credit_minor/);
    assert.match(sql, /utilization_percentage/);
    assert.match(sql, /approaching_limit/);
  }
  assert.match(migration, /not coalesce\(enforcement_enabled, false\)/);
  assert.match(migration, /select\s+business_id,\s+customer_id,\s+account_id,\s+contractual_due_minor,\s+paid_minor,\s+outstanding_minor,/);
  assert.match(migration, /Never block a payment, credit, void or archive that reduces exposure/);
  assert.match(migration, /public\.has_business_permission\(selected_account\.business_id, 'case\.manage'\)/);
  assert.match(migration, /One or more invoices are already assigned to a recovery case/);
  assert.match(migration, /from unnest\(selected_ids\) obligation_id/);
  assert.match(migration, /'opening_payment_credit', selected_paid/);
  assert.match(migration, /receivables_sync_case_obligations\(created_case_id\)/);
  assert.match(migration, /c\.case_scope = 'account_balance'/);
  assert.match(migration, /active_obligation\.status not in \('void', 'written_off'\)/);
  assert.match(rls, /R17 account_mode, credit limits and warning thresholds/);
  assert.match(rls, /security_invoker/);
});

test("customer overview and API expose invoice-level and account-level chasing", () => {
  const route = read("src/app/api/debtors/[debtorId]/receivables/route.ts");
  const overview = read("src/components/debtors/customer-receivables-overview.tsx");
  const settings = read("src/components/settings/credit-policy-panel.tsx");
  const types = read("src/lib/supabase/types.ts");

  assert.match(route, /account_receivable_totals/);
  assert.match(route, /receivables_create_recovery_case/);
  assert.match(route, /ownedCustomer\(debtorId, "case\.manage"\)/);
  assert.match(route, /export async function PATCH/);
  assert.match(overview, /Edit account/);
  assert.match(overview, /Chase account balance/);
  assert.match(overview, /Chase invoice/);
  assert.match(overview, /Latest invoices/);
  assert.match(overview, /Ongoing \/ Recurring/);
  assert.match(overview, /Approaching Credit Limit/);
  assert.match(settings, /Advisory warnings only/);
  assert.match(types, /export type CustomerAccountMode = "one_off" \| "ongoing"/);
  assert.match(types, /credit_warning: CreditLimitWarning/);
});
