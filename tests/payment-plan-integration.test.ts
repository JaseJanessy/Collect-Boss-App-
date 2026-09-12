import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { allocateApprovedPayments } from "../src/lib/payment-plans/allocation.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260807_payment_plan_integration.sql");
const schema = read("supabase/schema.sql");
const rls = read("src/lib/supabase/rls.sql");

test("legacy and integrated payment-plan statuses remain mapped", () => {
  for (const status of ["pending_acceptance", "active", "defaulted", "completed", "cancelled"]) {
    assert.match(schema, new RegExp(`'${status}'`));
  }
  for (const status of ["scheduled", "partial", "paid", "overdue", "cancelled"]) {
    assert.match(schema, new RegExp(`'${status}'`));
  }
});

test("FIFO allocation transparently carries a payment across installments", () => {
  const result = allocateApprovedPayments({
    installments: [
      { id: "first", dueDate: "2026-08-01", amountMinor: 5000n },
      { id: "second", dueDate: "2026-09-01", amountMinor: 5000n },
    ],
    payments: [{ id: "payment", amountMinor: 7500n, createdAt: "2026-08-02T00:00:00Z", reviewStatus: "approved" }],
    asOfDate: "2026-08-02",
  });
  assert.deepEqual(result.allocations.map((item) => [item.installmentId, item.amountMinor]), [["first", 5000n], ["second", 2500n]]);
  assert.deepEqual(result.installments.map((item) => item.status), ["paid", "partial"]);
});

test("scheduler persists due-soon, due-today, and missed events once", () => {
  for (const event of ["due_soon", "due_today", "missed"]) assert.match(migration, new RegExp(`'${event}'`));
  assert.match(migration, /payment_plan_events_installment_once_idx/);
  assert.match(migration, /on conflict do nothing returning id into v_inserted/i);
  assert.match(migration, /if v_inserted is not null then[\s\S]*insert into public\.notifications/i);
  assert.match(read("supabase/migrations/20260806_secure_payment_proof_flow.sql"), /unique \(type, entity_id\)/i);
  assert.match(migration, /on conflict \(type, entity_id\) do nothing/i);
});

test("completion resolves plan actions and financial recalculation remains authoritative", () => {
  assert.match(migration, /update public\.payment_plans set status = 'completed'/i);
  assert.match(migration, /update public\.action_centre_items set status = 'completed'/i);
  const priorProgress = read("supabase/migrations/20260724_payment_plan_progress.sql");
  assert.match(priorProgress, /perform public\.payment_plan_reconcile_case\(p_case_id\)/i);
  assert.match(migration, /v_case\.outstanding_minor = 0/i);
});

test("one open schedule and one debtor acceptance remain authoritative", () => {
  assert.match(schema, /payment_plans_one_open_plan_per_case_idx[\s\S]*where status in \('pending_acceptance', 'active', 'defaulted'\)/i);
  const acceptance = read("supabase/migrations/20260723_payment_plan_proposal_acceptance.sql");
  assert.match(acceptance, /if exists \(select 1 from public\.payment_plans[\s\S]*an open payment plan already exists/i);
  assert.match(acceptance, /p_decision = 'accepted'[\s\S]*set status = 'active'[\s\S]*status = 'payment_promise'/i);
});

test("plan events are owner-scoped and scheduler remains server-only", () => {
  assert.match(rls, /payment_plan_events_owner_read[\s\S]*business_id = my_business_id\(\)/i);
  assert.match(migration, /revoke all on function public\.payment_plan_run_scheduler\(date, integer\) from public/i);
  assert.match(migration, /grant execute on function public\.payment_plan_run_scheduler\(date, integer\) to service_role/i);
  const route = read("src/app/api/cron/payment-plans/route.ts");
  const authorization = read("src/lib/cron/authorization.ts");
  assert.match(route, /authorizeCronRequest/);
  assert.match(authorization, /process\.env\.CRON_SECRET/);
  assert.match(route, /getServiceClient/);
  const planRoute = read("src/app/api/cases/[caseId]/payment-plans/route.ts");
  assert.match(planRoute, /eq\("business_id", auth\.businessId\)/);
  assert.doesNotMatch(planRoute, /getServiceClient/);
  const actionRoute = read("src/app/api/action-centre/route.ts");
  const priorityMigration = read("supabase/migrations/20260829_action_priority_dashboard.sql");
  assert.match(actionRoute, /getAuthenticatedBusiness\("case\.read"\)/);
  assert.match(actionRoute, /action_centre_dashboard/);
  assert.match(priorityMigration, /a\.business_id=v_business_id/);
});

test("case and debtor views expose safe installment progress", () => {
  const casePage = read("src/components/pages/case-detail-page.tsx");
  const debtorPage = read("src/components/pages/payments/debtor-payment-page.tsx");
  const publicService = read("src/lib/public-access/service.ts");
  assert.match(casePage, /activePlan\?\.installments/);
  assert.match(casePage, /Payment-plan timeline/);
  assert.match(debtorPage, /Your next payment is/);
  assert.match(publicService, /select\("sequence_no, due_date, amount_minor, paid_minor, status"\)/);
  assert.doesNotMatch(publicService, /payment_plan_installments"\)\.select\("[^\"]*(notes|metadata|rejection_reason)/i);
});
