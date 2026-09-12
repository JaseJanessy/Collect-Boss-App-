import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260918_pocket_simple_invoice_addon.sql");
const server = read("src/lib/pocket/invoices-server.ts");
const model = read("src/lib/pocket/invoices.ts");
const pdf = read("src/lib/pdf/pocket-invoice-generator.ts");
const ui = read("src/components/pocket/pocket-invoices.tsx");
const billing = read("supabase/migrations/20260913_pocket_entitlements_billing_usage.sql");
const billingUi = read("src/components/pocket/pocket-billing-panel.tsx");

test("invoice add-on reuses the committed RM10 30-plus-30 commercial policy", () => {
  assert.match(billing, /pocket_invoice_addon','pocket','addon',1000,'MYR','month'/);
  assert.match(billing, /pocket_extra_invoice_pack','pocket','cycle_pack',1000,'MYR','cycle'/);
  assert.match(billing, /'pocket\.invoice\.create'/);
  assert.match(model, /POCKET_INVOICE_HARD_LIMIT = 60/);
  assert.match(ui, /issued this cycle/);
  assert.match(ui, /hard maximum is 60/);
  assert.match(ui, /Upgrade to Solo/);
  assert.match(billingUi, /!value\.addOns\.simpleInvoice/);
  assert.match(billingUi, /!value\.addOns\.extraInvoicePack/);
});

test("draft save, issue quota and invoice numbering are transactional and concurrency safe", () => {
  assert.match(migration, /pocket_save_simple_invoice_draft/);
  assert.match(migration, /pocket_issue_simple_invoice/);
  assert.match(migration, /for update/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /pocket_commit_invoice_usage/);
  assert.match(migration, /CBP-'\|\|v_year::text\|\|'-'\|\|lpad\(v_sequence::text,6,'0'\)/);
  assert.match(migration, /unique \(business_id,invoice_number\)/);
  assert.match(billing, /committed_numbers_are_not_restored_on_cancellation/);
  assert.match(ui, /previewing a draft do not use a number or quota/);
});

test("invoice conversion creates exactly one shared Pocket obligation", () => {
  assert.match(migration, /pocket_convert_invoice_to_debt/);
  assert.match(migration, /unique \(business_id,obligation_id\)/);
  assert.match(migration, /insert into public\.obligations/);
  assert.match(migration, /'simple_invoice_id',p_invoice_id/);
  assert.doesNotMatch(server, /from\("pocket_simple_invoices"\)\.update\(\{[^}]*paid_minor/s);
  assert.match(server, /from\("obligations"\)\.select\("id,paid_minor,outstanding_minor"\)/);
  assert.match(ui, /Paid from shared ledger/);
});

test("issued state is immutable and status follows authoritative allocations", () => {
  assert.match(migration, /POCKET_INVOICE_IMMUTABLE/);
  assert.match(migration, /after update of paid_minor,status on public\.obligations/);
  assert.match(migration, /when new\.outstanding_minor=0 then 'paid'/);
  assert.match(migration, /when new\.paid_minor>0 then 'partially_paid'/);
  assert.match(model, /linkedOutstandingMinor === 0/);
});

test("PDFs and logos are private, authorised and user-shared without a public invoice route", () => {
  assert.match(migration, /'pocket-invoices','pocket-invoices',false/);
  assert.match(server, /cacheControl: "private, no-store"/);
  assert.match(server, /POCKET_INVOICE_BUCKET/);
  assert.match(read("src/app/api/pocket/invoices/[invoiceId]/pdf/route.ts"), /requirePocketBillingAccess\("case\.read"\)/);
  assert.match(ui, /navigator\.share/);
  assert.match(ui, /navigator\.canShare/);
  assert.doesNotMatch(ui + server, /graph\.facebook\.com|messages\/send|whatsapp_business_messaging/);
  assert.doesNotMatch(read("src/app/api/pocket/invoices/[invoiceId]/pdf/route.ts"), /api\/public/);
});

test("the e-Invoice boundary is prominent in UI, PDF and immutable metadata", () => {
  for (const source of [model, migration]) assert.match(source, /NOT AN OFFICIAL E-INVOICE SERVICE/);
  assert.match(pdf, /POCKET_INVOICE_DISCLAIMER/);
  assert.match(ui, /POCKET_INVOICE_DISCLAIMER/);
  assert.doesNotMatch(ui + pdf, /LHDN compliant|LHDN approved|government submission included|official e-Invoice provider/iu);
});

test("invoice due reminders extend the Pocket scheduler only while entitlement is active", () => {
  const reminders = read("src/lib/pocket/reminders-server.ts");
  assert.match(migration, /event_type in \('due_soon','due_today','overdue','still_overdue','partial_balance','invoice_due'\)/);
  assert.match(reminders, /pocket_get_entitlements/);
  assert.match(reminders, /view\?\.addOns\?\.simpleInvoice/);
  assert.match(reminders, /event_type: "invoice_due"/);
  assert.match(reminders, /action_url: schedule\.invoice_id \? `\/pocket\/invoices/);
});
