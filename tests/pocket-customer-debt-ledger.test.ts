import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260914_pocket_customer_debt_ledger.sql");
const customersRoute = read("src/app/api/pocket/customers/route.ts");
const customerRoute = read("src/app/api/pocket/customers/[customerId]/route.ts");
const debtsRoute = read("src/app/api/pocket/debts/route.ts");
const debtRoute = read("src/app/api/pocket/debts/[debtId]/route.ts");
const pocketUI = [
  read("src/components/pocket/pocket-ledger.tsx"),
  read("src/app/pocket/debts/page.tsx"),
  read("src/app/pocket/due-today/page.tsx"),
].join("\n");

test("Pocket customer reads and writes are tenant scoped and duplicate reviewed", () => {
  assert.match(customersRoute, /\.eq\("business_id", access\.businessId\)/);
  assert.match(customerRoute, /\.eq\("business_id", access\.businessId\)/);
  assert.match(customersRoute, /DUPLICATE_REVIEW_REQUIRED/);
  assert.match(customersRoute, /same_email/);
  assert.match(customersRoute, /same_phone/);
  assert.match(customersRoute, /similar_name/);
  assert.match(customersRoute, /confirmSeparate/);
});

test("Pocket debt uses shared obligations and authoritative payment projections", () => {
  assert.match(debtsRoute, /from\("obligations"\)/);
  assert.match(debtsRoute, /obligation_type: "general_obligation"/);
  assert.match(debtsRoute, /paid_minor: 0/);
  assert.doesNotMatch(debtRoute, /paid_minor\s*:/);
  assert.match(migration, /pocket_sync_debt_status/);
  assert.match(migration, /new\.outstanding_minor=0 then 'paid'/);
});

test("quota counts only active, partial and overdue Pocket balances", () => {
  assert.match(migration, /v\.origin_product_type='pocket'/);
  assert.match(migration, /v\.status in\('open','partial','overdue'\)/);
  assert.match(migration, /greatest\(v\.original_amount_minor\+v\.adjustments_minor-v\.paid_minor,0\)>0/);
  assert.doesNotMatch(migration.match(/create or replace function public\.pocket_obligation_is_active[\s\S]*?\$\$;/)?.[0] ?? "", /'draft'/);
});

test("Pocket UI keeps the product deliberately simple and history preserving", () => {
  for (const label of ["Add Customer", "Add Debt", "Who Owes Me", "Due Today", "Customer Profile"]) assert.match(pocketUI, new RegExp(label));
  assert.match(pocketUI, /does not create an invoice or a collection case/i);
  assert.match(pocketUI, /Archiving preserves the profile and history/);
  assert.match(pocketUI, /No approved payment|Recent payments & receipts/i);
});
