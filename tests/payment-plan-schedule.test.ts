import assert from "node:assert/strict";
import test from "node:test";
import { buildInstallmentPreview } from "../src/lib/payment-plans/schedule.ts";

test("monthly schedules retain the first due date and clamp month ends", () => {
  const schedule = buildInstallmentPreview({ totalMinor: 10000n, count: 3, firstDueDate: "2027-01-31", frequency: "monthly" });
  assert.deepEqual(schedule.map((item) => item.dueDate), ["2027-01-31", "2027-02-28", "2027-03-31"]);
});

test("the final instalment retains the exact rounding remainder", () => {
  const schedule = buildInstallmentPreview({ totalMinor: 10000n, count: 3, firstDueDate: "2026-08-03", frequency: "weekly" });
  assert.deepEqual(schedule.map((item) => item.amountMinor), [3333n, 3333n, 3334n]);
  assert.equal(schedule.reduce((sum, item) => sum + item.amountMinor, 0n), 10000n);
});

test("custom schedules require strictly increasing civil dates", () => {
  assert.throws(() => buildInstallmentPreview({ totalMinor: 1000n, count: 2, firstDueDate: "2026-08-01", frequency: "custom", customDueDates: ["2026-08-01", "2026-08-01"] }));
});
