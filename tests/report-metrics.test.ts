import test from "node:test";
import assert from "node:assert/strict";
import { calculateReportMetrics, sanitizeCsvCell } from "../src/lib/reports/metrics.ts";

const baseCases = [
  { id: "case-current", debtorName: "Current", invoiceNo: null, dueDate: "2026-07-18", status: "action_needed", archivedAt: null, contractualDueMinor: 10000, approvedPaymentMinor: 0, outstandingMinor: 10000, createdAt: "2026-01-01T00:00:00Z" },
  { id: "case-30", debtorName: "30 days", invoiceNo: "=danger", dueDate: "2026-06-18", status: "partial_paid", archivedAt: null, contractualDueMinor: 20000, approvedPaymentMinor: 5000, outstandingMinor: 15000, createdAt: "2026-01-01T00:00:00Z" },
  { id: "case-31", debtorName: "31 days", invoiceNo: null, dueDate: "2026-06-17", status: "payment_promise", archivedAt: null, contractualDueMinor: 5000, approvedPaymentMinor: 0, outstandingMinor: 5000, createdAt: "2026-01-01T00:00:00Z" },
  { id: "case-91", debtorName: "91 days", invoiceNo: null, dueDate: "2026-04-18", status: "formal_demand_ready", archivedAt: null, contractualDueMinor: 8000, approvedPaymentMinor: 0, outstandingMinor: 8000, createdAt: "2026-01-01T00:00:00Z" },
];

test("report metrics use Malaysia calendar boundaries and current ledger projections", () => {
  const metrics = calculateReportMetrics(baseCases, [
    { caseId: "case-30", type: "payment_approved", amountMinor: 5000, createdAt: "2026-07-03T00:00:00Z" },
    { caseId: "case-30", type: "payment_reversal", amountMinor: 1000, createdAt: "2026-07-10T00:00:00Z" },
  ], { now: new Date("2026-07-18T12:00:00Z"), planCaseIds: new Set(["case-31"]), legalCaseIds: new Set(["case-91"]) });
  assert.equal(metrics.totalOutstandingMinor, 38000);
  assert.equal(metrics.totalCollectedMinor, 5000);
  assert.equal(metrics.overdueCases, 3);
  assert.deepEqual(metrics.ageing.map((item) => [item.label, item.count]), [["Current", 1], ["1-30", 1], ["31-60", 1], ["61-90", 0], ["91+", 1]]);
  assert.equal(metrics.planCases, 1);
  assert.equal(metrics.legalCases, 1);
  assert.equal(metrics.monthlyCollections.at(-1)?.amountMinor, 4000);
});

test("CSV cells cannot execute spreadsheet formulas", () => {
  assert.equal(sanitizeCsvCell("=SUM(A1:A2)"), "\"'=SUM(A1:A2)\"");
  assert.equal(sanitizeCsvCell("-12"), "\"'-12\"");
  assert.equal(sanitizeCsvCell('A "quoted" name'), "\"A \"\"quoted\"\" name\"");
});
