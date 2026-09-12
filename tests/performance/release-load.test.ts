import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "vitest";
import { buildStructuredExtraction } from "../../src/lib/document-intake/extraction/classifier.ts";
import { rankPaymentCandidates } from "../../src/lib/payment-matching/engine.ts";
import { calculateReportMetrics } from "../../src/lib/reports/metrics.ts";

function within(label: string, startedAt: number, maximumMs: number) {
  const duration = performance.now() - startedAt;
  process.stdout.write(`PERF ${label} duration_ms=${duration.toFixed(1)} ceiling_ms=${maximumMs}\n`);
  assert.ok(duration < maximumMs, `${label} took ${Math.round(duration)} ms; local ceiling is ${maximumMs} ms`);
}

test("representative high-volume case reporting remains bounded", () => {
  const cases = Array.from({ length: 25_000 }, (_, index) => ({
    id: `case-${index}`, debtorName: `Synthetic debtor ${index}`, invoiceNo: `INV-${index}`,
    dueDate: "2026-07-01", status: index % 7 === 0 ? "payment_promise" : "action_needed",
    archivedAt: null, currency: "MYR", contractualDueMinor: 10_000,
    approvedPaymentMinor: index % 3 === 0 ? 2_500 : 0, outstandingMinor: index % 3 === 0 ? 7_500 : 10_000,
    createdAt: "2026-01-01T00:00:00Z",
  }));
  const events = cases.filter((_, index) => index % 3 === 0).map((item) => ({
    caseId: item.id, type: "payment_approved" as const, amountMinor: 2_500, createdAt: "2026-07-10T00:00:00Z", currency: "MYR",
  }));
  const started = performance.now();
  const result = calculateReportMetrics(cases, events, { now: new Date("2026-08-01T00:00:00Z") });
  assert.equal(result.activeCases, 25_000);
  within("25k-case reporting", started, 10_000);
});

test("representative OCR classification workload remains bounded", () => {
  const pages = Array.from({ length: 2_000 }, (_, index) => ({
    page: index + 1, imageId: null,
    text: `DuitNow Transfer Successful MYR 3,500.00 Reference TXN${String(index).padStart(8, "0")} Maybank 2026-08-12`,
    lines: [{ text: "Transfer Successful MYR 3,500.00", confidence: 0.94, boundingBox: { x: 1, y: 1, width: 100, height: 10 } }],
  }));
  const started = performance.now();
  const result = buildStructuredExtraction(pages);
  assert.ok(result.amount_candidates.length > 0);
  within("2k-page extraction classification", started, 10_000);
});

test("representative payment candidate workload remains bounded and capped", () => {
  const targets = Array.from({ length: 500 }, (_, index) => ({
    key: `target-${index}`, customerId: `customer-${index}`, customerName: `Synthetic debtor ${index}`,
    customerPhone: null, accountId: `account-${index}`, accountReference: `ACC-${index}`,
    obligationId: `obligation-${index}`, invoiceNumber: `INV-${index}`, issueDate: "2026-07-01",
    dueDate: "2026-07-31", outstandingMinor: 10_000 + index, currency: "MYR", caseId: `case-${index}`,
    priorApprovedPaymentCount: index % 2, existingPayments: [],
  }));
  const started = performance.now();
  for (let index = 0; index < 1_000; index += 1) {
    const candidates = rankPaymentCandidates({
      id: `transaction-${index}`, amountMinor: 10_000 + (index % 500), currency: "MYR",
      occurredAt: "2026-07-30", reference: `INV-${index % 500}`, invoiceNumber: `INV-${index % 500}`,
      partyName: `Synthetic debtor ${index % 500}`, accountReference: null, phone: null, phoneMatchPermitted: false,
    }, targets);
    assert.ok(candidates.length <= 10);
  }
  within("500k payment candidate evaluations", started, 15_000);
});

test("representative retry-queue ordering and backoff workload remains bounded", () => {
  const jobs = Array.from({ length: 100_000 }, (_, index) => ({
    id: index, attempts: index % 12, nextAttemptAt: (index * 7919) % 1_000_000,
  }));
  const started = performance.now();
  jobs.sort((left, right) => left.nextAttemptAt - right.nextAttemptAt || left.id - right.id);
  const delays = jobs.map((job) => Math.min(24 * 60, 2 ** Math.min(job.attempts, 10)));
  assert.equal(delays.length, jobs.length);
  assert.ok(Math.max(...delays) <= 24 * 60);
  within("100k retry queue ordering", started, 5_000);
});
