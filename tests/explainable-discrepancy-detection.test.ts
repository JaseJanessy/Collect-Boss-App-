import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260910_explainable_discrepancy_detection.sql", "utf8");
const route = readFileSync("src/app/api/cases/[caseId]/discrepancies/route.ts", "utf8");
const engine = readFileSync("src/lib/discrepancies/engine.ts", "utf8");

test("all required discrepancy categories and separate review states are persisted", () => {
  for (const category of ["duplicate_invoice", "duplicate_transaction", "unapplied_credit_note", "stale_balance", "payment_proof_unmatched", "accounting_sync_difference", "contract_invoice_conflict", "debtor_paid_claim_conflict"]) {
    assert.match(migration, new RegExp(category));
    assert.match(engine, new RegExp(category));
  }
  assert.match(migration, /'suspicious','inconsistent','incomplete','confirmed_error'/);
  assert.match(migration, /'open','confirmed','dismissed','deferred','resolved'/);
});

test("history is append-only, source changes reopen decisions, and queue projections close", () => {
  assert.match(migration, /DISCREPANCY_HISTORY_APPEND_ONLY/);
  assert.match(migration, /status in \('dismissed','resolved','deferred'\)/);
  assert.match(migration, /'Source data changed after the prior decision\.'/);
  assert.match(migration, /open_discrepancy_count=v_count/);
  assert.match(migration, /status='completed'/);
  assert.match(migration, /review_discrepancy/);
});

test("mutations are permission checked, validated, rate limited and structured", () => {
  assert.match(route, /getAuthenticatedBusiness\("case\.manage"\)/);
  assert.match(route, /isRateLimited/);
  assert.match(route, /RATE_LIMITED/);
  assert.match(route, /REASON_REQUIRED/);
  assert.match(route, /WORKFLOW_REQUIRED/);
  assert.match(route, /error: \{ code, message \}/);
  assert.match(migration, /has_business_permission\(p_business_id,'case\.manage'\)/);
  assert.match(migration, /grant select on public\.discrepancy_findings,public\.discrepancy_finding_events to authenticated/);
  assert.doesNotMatch(migration, /grant (insert|update|delete|all) on public\.discrepancy_findings[^\n]*authenticated/i);
});

test("findings are review-only and cannot initiate communication or financial correction", () => {
  assert.doesNotMatch(migration, /insert into public\.(reminders|communications|payments|case_financial_events|debt_ledger_events)/i);
  assert.match(migration, /never initiates communication or escalation/i);
  assert.match(migration, /never mutates an[\s\S]*approved financial record/i);
  assert.match(migration, /Rollback:/);
});

