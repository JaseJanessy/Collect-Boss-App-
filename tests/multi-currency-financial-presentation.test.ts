import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateReportMetrics } from "../src/lib/reports/metrics.ts";
import {
  formatCurrencyMinor,
  getCurrencyMetadata,
  minorToDecimalString,
  parseCurrencyToMinor,
} from "../src/lib/financial/money.ts";
import { calculateStatementLedger } from "../src/lib/statements/calculations.ts";

test("required currencies render for a Malaysia locale without changing stored minor units", () => {
  const examples = [
    ["MYR", "en-MY", false, /RM/],
    ["SGD", "en-SG", false, /S\$/],
    ["USD", "en-SG", false, /US\$/],
    ["GBP", "en-GB", false, /GBP/],
    ["AUD", "en-AU", false, /AUD/],
  ] as const;
  for (const [currency, locale, explicitCode, expected] of examples) {
    const stored = parseCurrencyToMinor("1234.56", currency);
    assert.equal(stored, 123456n);
    assert.match(formatCurrencyMinor(stored, currency, { locale, explicitCode }), expected);
    assert.equal(stored, 123456n, "presentation must not mutate the stored amount");
  }
});

test("generic ISO metadata supports non-two-decimal currencies exactly", () => {
  assert.equal(getCurrencyMetadata("JPY").minorUnit, 0);
  assert.equal(parseCurrencyToMinor("1250", "JPY"), 1250n);
  assert.throws(() => parseCurrencyToMinor("1250.1", "JPY"), /at most 0 decimal places/);
  assert.equal(getCurrencyMetadata("KWD").minorUnit, 3);
  assert.equal(parseCurrencyToMinor("12.345", "KWD"), 12345n);
  assert.equal(minorToDecimalString(12345n, "KWD"), "12.345");
  assert.throws(() => parseCurrencyToMinor("12.3456", "KWD"), /at most 3 decimal places/);
});

test("partial payments and adjustments reconcile independently by currency", () => {
  const metrics = calculateReportMetrics([
    { id: "gbp-1", debtorName: "Mixed customer", invoiceNo: "GB-1", currency: "GBP", dueDate: "2026-06-01", status: "partial_paid", archivedAt: null, contractualDueMinor: 10000, approvedPaymentMinor: 2500, outstandingMinor: 7500, createdAt: "2026-05-01T00:00:00Z" },
    { id: "usd-1", debtorName: "Mixed customer", invoiceNo: "US-1", currency: "USD", dueDate: "2026-06-01", status: "action_needed", archivedAt: null, contractualDueMinor: 20000, approvedPaymentMinor: 0, outstandingMinor: 20000, createdAt: "2026-05-01T00:00:00Z" },
  ], [
    { caseId: "gbp-1", currency: "GBP", type: "payment_approved", amountMinor: 2500, createdAt: "2026-07-01T00:00:00Z" },
    { caseId: "gbp-1", currency: "GBP", type: "adjustment_credit", adjustmentType: "credit_note", amountMinor: 500, createdAt: "2026-07-02T00:00:00Z" },
  ], { now: new Date("2026-07-10T00:00:00Z") });

  assert.equal(metrics.isMultiCurrency, true);
  assert.equal(metrics.totalOutstandingMinor, 0, "compatibility total must not combine GBP and USD");
  assert.deepEqual(metrics.totalsByCurrency.map((item) => [item.currency, item.totalOutstandingMinor]), [["GBP", 7500], ["USD", 20000]]);
  assert.equal(metrics.totalsByCurrency.find((item) => item.currency === "GBP")?.totalCreditNotesMinor, 500);
  assert.deepEqual(metrics.topCustomers, [], "mixed-currency customer values must not be ranked using an invalid sum");
});

test("a USD payment event cannot reduce a GBP case", () => {
  assert.throws(() => calculateReportMetrics([
    { id: "gbp-1", debtorName: "Customer", invoiceNo: null, currency: "GBP", dueDate: "2026-06-01", status: "partial_paid", archivedAt: null, contractualDueMinor: 10000, approvedPaymentMinor: 1000, outstandingMinor: 9000, createdAt: "2026-05-01T00:00:00Z" },
  ], [
    { caseId: "gbp-1", currency: "USD", type: "payment_approved", amountMinor: 1000, createdAt: "2026-07-01T00:00:00Z" },
  ], { now: new Date("2026-07-10T00:00:00Z") }), /does not match case/);
});

test("single-currency MYR reporting preserves the previous aggregate behaviour", () => {
  const metrics = calculateReportMetrics([
    { id: "myr-1", debtorName: "Customer", invoiceNo: null, currency: "MYR", dueDate: "2026-07-01", status: "partial_paid", archivedAt: null, contractualDueMinor: 10000, approvedPaymentMinor: 2500, outstandingMinor: 7500, createdAt: "2026-05-01T00:00:00Z" },
  ], [], { now: new Date("2026-07-10T00:00:00Z") });
  assert.equal(metrics.isMultiCurrency, false);
  assert.equal(metrics.totalOutstandingMinor, 7500);
  assert.equal(metrics.totalCollectedMinor, 2500);
  assert.equal(metrics.totalsByCurrency[0]?.currency, "MYR");
});

test("statement ledger reconciles multiple invoices without floating-point arithmetic", () => {
  const ledger = calculateStatementLedger([
    { id: "a", debtorId: "d", customerName: "Customer", customerCompany: null, invoiceNo: "A", originalPrincipalMinor: 10001, createdAt: "2026-01-01T00:00:00Z", status: "partial_paid", dueDate: "2026-01-31" },
    { id: "b", debtorId: "d", customerName: "Customer", customerCompany: null, invoiceNo: "B", originalPrincipalMinor: 20002, createdAt: "2026-01-02T00:00:00Z", status: "partial_paid", dueDate: "2026-02-01" },
  ], [
    { id: "p1", caseId: "a", type: "payment_approved", amountMinor: 3334, createdAt: "2026-02-01T00:00:00Z" },
    { id: "c1", caseId: "b", type: "adjustment_credit", adjustmentType: "credit_note", amountMinor: 1001, createdAt: "2026-02-02T00:00:00Z" },
  ], { from: new Date("2026-01-01T00:00:00Z"), toExclusive: new Date("2026-03-01T00:00:00Z"), label: "test" });
  assert.equal(ledger.periodDebitsMinor, 30003);
  assert.equal(ledger.periodPaymentsMinor, 3334);
  assert.equal(ledger.periodCreditsMinor, 1001);
  assert.equal(ledger.closingBalanceMinor, 25668);
  assert.equal(ledger.totalOutstandingMinor, 25668);
});

test("I02 migration and exports preserve currency and enforce reconciliation guards", () => {
  const migration = readFileSync("supabase/migrations/20260827_i02_multi_currency_financial_presentation.sql", "utf8");
  const reportExport = readFileSync("src/app/api/reports/export/route.ts", "utf8");
  const businessExport = readFileSync("src/lib/exports/business-data.ts", "utf8");
  assert.match(migration, /Payment currency .* does not match obligation currency/);
  assert.match(migration, /Cross-currency financial event detected/);
  assert.match(migration, /group by business_id,customer_id,currency/);
  assert.match(migration, /Every import row requires a valid ISO currency code/);
  assert.doesNotMatch(migration, /fx_rate|exchange_rate/i, "I02 must not invent an FX conversion path");
  assert.match(reportExport, /Currency,Contractual due,Collected cash,Outstanding/);
  assert.match(businessExport, /amount_minor, currency/);
});
