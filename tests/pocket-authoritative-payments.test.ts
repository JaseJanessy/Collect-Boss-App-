import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
const read=(path:string)=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const sql=read("supabase/migrations/20260915_pocket_authoritative_payments.sql");
const post=read("src/app/api/pocket/payments/route.ts");
const preview=read("src/app/api/pocket/payments/preview/route.ts");
const reverse=read("src/app/api/pocket/payments/[allocationId]/reverse/route.ts");
const reports=read("src/app/api/pocket/reports/summary/route.ts");
const ui=[read("src/components/pocket/pocket-payments.tsx"),read("src/app/pocket/payments/new/page.tsx")].join("\n");

test("Pocket extends the shared payment truth without a second payment table",()=>{
  for(const table of ["payment_receipts","payment_allocations","payment_operation_idempotency_keys"])assert.match(sql,new RegExp(`public\\.${table}`));
  assert.match(sql,/payment_operation_create_journal/);
  assert.doesNotMatch(sql,/create table if not exists public\.pocket_payments/);
  assert.match(sql,/alter column case_id drop not null/);
  assert.match(sql,/case_id is null and case_financial_event_id is null and obligation_id is not null/);
});

test("posting is tenant scoped, decimal safe, entitlement checked and retry safe",()=>{
  assert.match(post,/requirePocketBillingAccess\("payment\.approve"\)/);
  assert.match(post,/pocket\.payment\.record/);
  assert.match(post,/parseCurrencyToMinor/);
  assert.match(post,/idempotency-key/);
  assert.doesNotMatch(post,/businessId:/);
  assert.match(sql,/where id=p_debt_id and business_id=p_business_id/);
  assert.match(sql,/pocket_authorize_capability_internal/);
  assert.match(sql,/action_scope='pocket_post_payment'/);
});

test("stale and concurrent payments cannot overdraw an obligation",()=>{
  assert.match(sql,/for update/);
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/p_expected_outstanding_minor is distinct from v_debt\.outstanding_minor/);
  assert.match(sql,/p_amount_minor>v_debt\.outstanding_minor/);
  assert.match(preview,/resultingRemainingMinor/);
  assert.doesNotMatch(ui,/name="remaining/i);
});

test("full, partial and reversal states come from committed obligation truth",()=>{
  assert.match(sql,/update public\.obligations set paid_minor=paid_minor\+p_amount_minor/);
  assert.match(sql,/when status='paid' or outstanding_minor=0 then 'settled'/);
  assert.match(sql,/when paid_minor>0 then 'partially_paid'/);
  assert.match(sql,/event_type,reverses_allocation_id/);
  assert.match(sql,/update public\.obligations set paid_minor=paid_minor-v_original\.target_amount_minor/);
  assert.match(sql,/collectboss\.pocket_financial_correction/);
  assert.match(reverse,/pocket_reverse_payment/);
});

test("Pocket UX is simplified and documents its V1 and receipt boundaries",()=>{
  for(const label of ["Record Payment","Review Payment","Confirm Payment","Paid","Remaining","Reverse Payment"])assert.match(ui,new RegExp(label));
  assert.match(ui,/V1 records one payment against one debt/);
  assert.match(ui,/You can also scan a receipt and confirm the details before recording it/);
});

test("Pocket reports reconcile from generated obligation balances and allocation reversals",()=>{
  assert.match(reports,/from\("obligations"\)/);
  assert.match(reports,/from\("payment_allocations"\)/);
  assert.match(reports,/event_type==="allocation"\?event\.target_amount_minor:-event\.target_amount_minor/);
  assert.match(reports,/row\.outstanding_minor/);
});
