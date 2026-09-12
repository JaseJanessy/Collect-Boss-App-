import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateStatementLedger } from "../src/lib/statements/calculations.ts";
import { calculateReportMetrics } from "../src/lib/reports/metrics.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260817_financial_adjustments.sql");
const schema = read("supabase/schema.sql");
const rls = read("src/lib/supabase/rls.sql");

test("classified adjustments are additive ledger records, never historical payment rewrites", () => {
  for (const type of [
    "credit_note", "settlement_adjustment", "write_off", "manual_correction",
    "returned_goods", "commercial_discount", "other",
  ]) assert.match(migration, new RegExp(`'${type}'`));
  assert.match(migration, /'financial_adjustments',v_adjustment\.id/i);
  assert.match(migration, /case when v_adjustment\.direction='credit' then 'adjustment_credit' else 'adjustment_debit'/i);
  const adjustmentService = migration.match(/create or replace function public\.financial_create_adjustment[\s\S]*?create or replace function public\.financial_review_write_off/i)?.[0] ?? "";
  assert.doesNotMatch(adjustmentService, /update public\.payments/i);
  assert.doesNotMatch(adjustmentService, /insert into public\.payments/i);
});

test("write-off requires a separate owner approval and records audit evidence", () => {
  assert.match(migration, /case when p_adjustment_type='write_off' then 'pending' else 'approved'/i);
  assert.match(migration, /financial_adjustment_assert_owner\(p_adjustment_id\)/i);
  assert.match(migration, /required_approver_role.*'owner'/i);
  assert.match(migration, /'write_off\.'\|\|p_decision/i);
  assert.match(migration, /if p_decision='approved' then v_adjustment:=public\.financial_adjustment_post/i);
});

test("settlement keeps cash and concession separate and must end at zero", () => {
  assert.match(migration, /v_payment:=public\.financial_create_owner_payment/i);
  assert.match(migration, /'settlement_adjustment','credit'/i);
  assert.match(migration, /if v_case\.outstanding_minor<>0 then raise exception 'Settlement did not resolve the final balance'/i);
});

test("manual correction captures old/new values and obligation totals remain synchronized", () => {
  assert.match(migration, /old_amount_minor,new_amount_minor/i);
  assert.match(migration, /v_effective_amount:=abs\(p_new_amount_minor-v_old_amount\)/i);
  assert.match(migration, /set_config\('collectboss\.receivables_sync','on',true\)/i);
  assert.match(migration, /perform public\.financial_recalculate_case\(v_adjustment\.case_id\)/i);
});

test("closure reasons are controlled and auditable", () => {
  for (const reason of [
    "paid_in_full", "settled", "written_off", "dispute_resolved",
    "cancelled", "duplicate", "professional_handoff", "other",
  ]) assert.match(schema, new RegExp(`'${reason}'`));
  assert.match(migration, /insert into public\.case_status_history/i);
  assert.match(migration, /'case\.closed'/i);
  assert.match(migration, /prevent_direct_closure_reason_update[\s\S]*controlled case closure service/i);
});

test("adjustment tables are tenant read-only and mutations use owner RPCs", () => {
  assert.match(rls, /financial_adjustments_owner_read[\s\S]*business_id = my_business_id\(\)/i);
  assert.match(rls, /financial_adjustment_events_owner_read[\s\S]*business_id = my_business_id\(\)/i);
  assert.match(migration, /grant execute on function public\.financial_create_adjustment[\s\S]*to authenticated/i);
  assert.doesNotMatch(rls, /financial_adjustments[\s\S]{0,100}for (insert|update|delete)/i);
});

test("statements distinguish credit notes, write-offs, settlements and ordinary adjustments", () => {
  const cases = [{
    id: "case-1", debtorId: "debtor", customerName: "Customer", customerCompany: null,
    invoiceNo: "INV-1", originalPrincipalMinor: 10000, createdAt: "2026-01-01T00:00:00Z",
    status: "paid", dueDate: "2026-01-31",
  }];
  const events = [
    { id: "credit", caseId: "case-1", type: "adjustment_credit" as const, amountMinor: 1000, createdAt: "2026-02-01T00:00:00Z", adjustmentType: "credit_note" as const },
    { id: "writeoff", caseId: "case-1", type: "adjustment_credit" as const, amountMinor: 2000, createdAt: "2026-02-02T00:00:00Z", adjustmentType: "write_off" as const },
    { id: "settlement", caseId: "case-1", type: "adjustment_credit" as const, amountMinor: 3000, createdAt: "2026-02-03T00:00:00Z", adjustmentType: "settlement_adjustment" as const },
    { id: "manual", caseId: "case-1", type: "adjustment_credit" as const, amountMinor: 500, createdAt: "2026-02-04T00:00:00Z", adjustmentType: "manual_correction" as const },
  ];
  const ledger = calculateStatementLedger(cases, events, {
    from: new Date("2026-01-01T00:00:00Z"), toExclusive: new Date("2026-03-01T00:00:00Z"), label: "Test",
  });
  assert.equal(ledger.transactions.find((item) => item.id === "credit")?.label, "Credit note");
  assert.equal(ledger.transactions.find((item) => item.id === "writeoff")?.category, "write_off");
  assert.equal(ledger.transactions.find((item) => item.id === "settlement")?.category, "settlement");
  assert.equal(ledger.periodWriteOffsMinor, 2000);
  assert.equal(ledger.periodSettlementsMinor, 3000);
  assert.equal(ledger.periodAdjustmentsMinor, 1500);
});

test("reports exclude every adjustment category from recovered cash", () => {
  const metrics = calculateReportMetrics([{
    id: "case-1", debtorName: "Customer", invoiceNo: "INV-1", dueDate: "2026-01-01",
    status: "paid", archivedAt: null, contractualDueMinor: 4000, approvedPaymentMinor: 2000,
    outstandingMinor: 0, createdAt: "2026-01-01T00:00:00Z",
  }], [
    { caseId: "case-1", type: "payment_approved", amountMinor: 2000, createdAt: "2026-02-01T00:00:00Z" },
    { caseId: "case-1", type: "adjustment_credit", amountMinor: 1000, createdAt: "2026-02-01T00:00:00Z", adjustmentType: "credit_note" },
    { caseId: "case-1", type: "adjustment_credit", amountMinor: 3000, createdAt: "2026-02-01T00:00:00Z", adjustmentType: "write_off" },
  ], { now: new Date("2026-02-10T00:00:00Z") });
  assert.equal(metrics.totalCollectedMinor, 2000);
  assert.equal(metrics.totalCreditNotesMinor, 1000);
  assert.equal(metrics.totalWriteOffsMinor, 3000);
});
