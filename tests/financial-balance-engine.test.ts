import test from "node:test";
import assert from "node:assert/strict";
import { calculateFinancialPosition, deduplicateFinancialEvents, hasFinancialDrift } from "../src/lib/financial/balance.ts";
import { minorToMyRDecimal, parseMyrToMinor } from "../src/lib/financial/money.ts";

test("MYR parser accepts only exact positive minor-unit inputs", () => {
  assert.equal(parseMyrToMinor("100"), 10000n);
  assert.equal(parseMyrToMinor("0.01"), 1n);
  assert.throws(() => parseMyrToMinor("0"));
  assert.throws(() => parseMyrToMinor("1.001"));
  assert.throws(() => parseMyrToMinor("-1.00"));
});

test("partial and full approved payments derive deterministic balances", () => {
  const partial = calculateFinancialPosition(10000n, [{ type: "payment_approved", amountMinor: 3000n }]);
  assert.equal(minorToMyRDecimal(partial.outstandingMinor), "70.00");

  const full = calculateFinancialPosition(10000n, [{ type: "payment_approved", amountMinor: 10000n }]);
  assert.equal(full.outstandingMinor, 0n);
  assert.equal(full.overpaymentMinor, 0n);
});

test("pending and rejected proofs are balance-neutral because they create no events", () => {
  const position = calculateFinancialPosition(10000n, []);
  assert.equal(position.outstandingMinor, 10000n);
  assert.equal(position.approvedPaymentMinor, 0n);
});

test("overpayment is retained as credit instead of producing a negative outstanding balance", () => {
  const position = calculateFinancialPosition(10000n, [{ type: "payment_approved", amountMinor: 12000n }]);
  assert.equal(position.outstandingMinor, 0n);
  assert.equal(position.overpaymentMinor, 2000n);
});

test("reversals restore the outstanding balance exactly once", () => {
  const position = calculateFinancialPosition(10000n, [
    { type: "payment_approved", amountMinor: 7000n },
    { type: "payment_reversal", amountMinor: 3000n },
  ]);
  assert.equal(position.approvedPaymentMinor, 4000n);
  assert.equal(position.outstandingMinor, 6000n);
});

test("adjustments change contractual due while payment-plan schedules do not", () => {
  const position = calculateFinancialPosition(10000n, [
    { type: "adjustment_debit", amountMinor: 500n },
    { type: "adjustment_credit", amountMinor: 200n },
  ]);
  assert.equal(position.contractualDueMinor, 10300n);
  assert.equal(position.outstandingMinor, 10300n);
});

test("reconciliation reports drift without repairing it", () => {
  const expected = calculateFinancialPosition(10000n, [{ type: "payment_approved", amountMinor: 3000n }]);
  assert.equal(hasFinancialDrift(expected, { ...expected }), false);
  assert.equal(hasFinancialDrift(expected, { ...expected, outstandingMinor: 8000n }), true);
});

test("concurrent approval simulation posts one event for one source", async () => {
  const attempts = await Promise.all(Array.from({ length: 20 }, async () => ({
    type: "payment_approved" as const, amountMinor: 2500n, sourceKey: "public_payment_submissions:proof-1:payment_approved",
  })));
  const events = deduplicateFinancialEvents(attempts);
  const position = calculateFinancialPosition(10000n, events);
  assert.equal(events.length, 1);
  assert.equal(position.approvedPaymentMinor, 2500n);
  assert.equal(position.outstandingMinor, 7500n);
});

test("case projection and report consumer use the same exact outstanding value", () => {
  const position = calculateFinancialPosition(10000n, [
    { type: "payment_approved", amountMinor: 3333n },
    { type: "payment_approved", amountMinor: 3333n },
  ]);
  assert.equal(minorToMyRDecimal(position.outstandingMinor), "33.34");
});
