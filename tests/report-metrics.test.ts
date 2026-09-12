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
  assert.equal(metrics.outstandingTrend.at(-1)?.outstandingMinor, metrics.totalOutstandingMinor);
});

test("CSV cells cannot execute spreadsheet formulas", () => {
  assert.equal(sanitizeCsvCell("=SUM(A1:A2)"), "\"'=SUM(A1:A2)\"");
  assert.equal(sanitizeCsvCell("-12"), "\"'-12\"");
  assert.equal(sanitizeCsvCell('A "quoted" name'), "\"A \"\"quoted\"\" name\"");
});

test("R19 analytics use recorded promise, plan, action, aging and closure outcomes", () => {
  const cases = [
    ...baseCases,
    { id: "case-closed", debtorName: "Closed customer", invoiceNo: null, dueDate: "2026-05-01", status: "closed", archivedAt: null, originalPrincipalMinor: 12000, contractualDueMinor: 12000, approvedPaymentMinor: 12000, outstandingMinor: 0, createdAt: "2026-05-01T00:00:00Z", closedAt: "2026-07-05T02:00:00Z", closureReason: "paid_in_full" },
  ];
  const metrics = calculateReportMetrics(cases, [
    { caseId: "case-30", type: "payment_approved", amountMinor: 5000, createdAt: "2026-07-03T00:00:00Z" },
    { caseId: "case-closed", type: "payment_approved", amountMinor: 12000, createdAt: "2026-07-05T02:00:00Z" },
  ], {
    now: new Date("2026-07-18T12:00:00Z"),
    promises: [
      { id: "kept", caseId: "case-30", promisedAmountMinor: 5000, amountFulfilledMinor: 5000, promiseDate: "2026-07-03", status: "fulfilled", createdAt: "2026-07-01T00:00:00Z", missedAt: null },
      { id: "missed", caseId: "case-31", promisedAmountMinor: 4000, amountFulfilledMinor: 1000, promiseDate: "2026-07-10", status: "missed", createdAt: "2026-07-01T00:00:00Z", missedAt: "2026-07-11T00:00:00Z" },
    ],
    plans: [
      { id: "plan-active", caseId: "case-31", status: "active", createdAt: "2026-06-01T00:00:00Z" },
      { id: "plan-complete", caseId: "case-closed", status: "completed", createdAt: "2026-05-01T00:00:00Z" },
    ],
    installments: [
      { planId: "plan-active", amountMinor: 2000, paidMinor: 0, dueDate: "2026-07-10", status: "overdue" },
      { planId: "plan-complete", amountMinor: 12000, paidMinor: 12000, dueDate: "2026-07-01", status: "paid" },
    ],
    actions: [
      { id: "due", caseId: "case-31", assigneeId: "user-1", status: "open", amountMinor: 5000, dueAt: "2026-07-18T02:00:00Z", createdAt: "2026-07-01T00:00:00Z", completedAt: null },
      { id: "done", caseId: "case-30", assigneeId: "user-1", status: "completed", amountMinor: 15000, dueAt: "2026-07-10T02:00:00Z", createdAt: "2026-07-01T00:00:00Z", completedAt: "2026-07-10T03:00:00Z" },
    ],
    currentUserId: "user-1",
  });

  assert.deepEqual(metrics.agingDonut.map((item) => item.label), ["0-30", "31-60", "61-90", "90+"]);
  assert.equal(metrics.actionsToday, 1);
  assert.deepEqual(metrics.promisePerformance, { total: 2, kept: 1, missed: 1, pending: 0, keptRate: 50, promisedMinor: 9000, fulfilledMinor: 6000 });
  assert.equal(metrics.paymentPlanPerformance.overdueInstallments, 1);
  assert.equal(metrics.paymentPlanPerformance.paidOnRecord, 1);
  assert.equal(metrics.closureOutcomes[0]?.reason, "Paid In Full");
  assert.equal(metrics.teamPerformance[0]?.assignee, "You");
  assert.equal(metrics.teamPerformance[0]?.completionRate, 50);
  assert.equal(metrics.forecast, null, "projection stays hidden without sufficient recovery history");
  assert.equal(metrics.recoveryMomentum.state, "insufficient_data");
});
