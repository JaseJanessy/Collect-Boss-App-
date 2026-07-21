import assert from "node:assert/strict";
import test from "node:test";
import { allocateApprovedPayments } from "../src/lib/payment-plans/allocation.ts";

const installments = [
  { id: "i-1", dueDate: "2026-08-01", amountMinor: 3333n },
  { id: "i-2", dueDate: "2026-09-01", amountMinor: 3333n },
  { id: "i-3", dueDate: "2026-10-01", amountMinor: 3334n },
];

test("allocates a partial approved payment to the earliest unpaid instalment", () => {
  const result = allocateApprovedPayments({ installments, payments: [{ id: "p-1", amountMinor: 2000n, createdAt: "2026-08-01T01:00:00Z", reviewStatus: "approved" }], asOfDate: "2026-08-01" });
  assert.deepEqual(result.installments.map(({ paidMinor, status }) => ({ paidMinor, status })), [{ paidMinor: 2000n, status: "partial" }, { paidMinor: 0n, status: "scheduled" }, { paidMinor: 0n, status: "scheduled" }]);
});

test("allocates multiple payments deterministically across instalments", () => {
  const result = allocateApprovedPayments({ installments, payments: [
    { id: "p-2", amountMinor: 5000n, createdAt: "2026-08-02T01:00:00Z", reviewStatus: "approved" },
    { id: "p-1", amountMinor: 2000n, createdAt: "2026-08-01T01:00:00Z", reviewStatus: "approved" },
  ], asOfDate: "2026-08-03" });
  assert.deepEqual(result.allocations.map((allocation) => allocation.amountMinor), [2000n, 1333n, 3333n, 334n]);
  assert.deepEqual(result.installments.map((item) => item.status), ["paid", "paid", "partial"]);
});

test("late unpaid instalments become overdue only after their grace period", () => {
  const result = allocateApprovedPayments({ installments, payments: [], asOfDate: "2026-08-04", graceDays: 2 });
  assert.equal(result.installments[0].status, "overdue");
  const withinGrace = allocateApprovedPayments({ installments, payments: [], asOfDate: "2026-08-03", graceDays: 2 });
  assert.equal(withinGrace.installments[0].status, "scheduled");
});

test("an early full payoff settles every instalment", () => {
  const result = allocateApprovedPayments({ installments, payments: [{ id: "p-1", amountMinor: 10000n, createdAt: "2026-07-20T01:00:00Z", reviewStatus: "approved" }], asOfDate: "2026-07-20" });
  assert.deepEqual(result.installments.map((item) => item.status), ["paid", "paid", "paid"]);
});

test("a reversed payment is excluded when the projection is rebuilt", () => {
  const result = allocateApprovedPayments({ installments, payments: [{ id: "p-1", amountMinor: 10000n, createdAt: "2026-07-20T01:00:00Z", reviewStatus: "reversed" }], asOfDate: "2026-07-20" });
  assert.equal(result.allocations.length, 0);
  assert.equal(result.installments[0].paidMinor, 0n);
});

test("duplicate concurrent delivery of one payment cannot double allocate it", () => {
  const payment = { id: "p-1", amountMinor: 5000n, createdAt: "2026-07-20T01:00:00Z", reviewStatus: "approved" as const };
  const result = allocateApprovedPayments({ installments, payments: [payment, payment], asOfDate: "2026-07-20" });
  assert.equal(result.installments.reduce((sum, item) => sum + item.paidMinor, 0n), 5000n);
});
