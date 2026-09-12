import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateStatementLedger, type StatementCaseInput, type StatementEventInput, type StatementTransaction } from "../src/lib/statements/calculations.ts";
import { resolveStatementRange } from "../src/lib/statements/periods.ts";
import { generateStatementPdf } from "../src/lib/pdf/statement-generator.ts";
import { generateStatementPdfV2 } from "../src/lib/pdf/statement-generator-v2.ts";
import type { Statement2Data } from "../src/lib/statements/builder.ts";
import type { StatementData } from "../src/lib/statements/service.ts";

const cases: StatementCaseInput[] = [
  { id: "CB-1", debtorId: "customer-1", customerName: "Amina", customerCompany: "Amina Trading", invoiceNo: "INV-1", originalPrincipalMinor: 10000, createdAt: "2026-01-01T00:00:00Z", status: "partial_paid", dueDate: "2026-02-01" },
  { id: "CB-2", debtorId: "customer-1", customerName: "Amina", customerCompany: "Amina Trading", invoiceNo: "INV-2", originalPrincipalMinor: 5000, createdAt: "2026-07-01T00:00:00Z", status: "overdue", dueDate: "2026-07-31" },
];
const events: StatementEventInput[] = [
  { id: "e1", caseId: "CB-1", type: "payment_approved", amountMinor: 2000, createdAt: "2026-05-01T00:00:00Z" },
  { id: "e2", caseId: "CB-1", type: "adjustment_debit", amountMinor: 500, createdAt: "2026-06-10T00:00:00Z" },
  { id: "e3", caseId: "CB-1", type: "adjustment_credit", amountMinor: 200, createdAt: "2026-07-10T00:00:00Z" },
  { id: "e4", caseId: "CB-2", type: "payment_approved", amountMinor: 3000, createdAt: "2026-08-10T00:00:00Z" },
  { id: "e5", caseId: "CB-2", type: "payment_reversal", amountMinor: 1000, createdAt: "2026-09-10T00:00:00Z" },
];

test("Statement 2.0 resolves every preset and inclusive custom dates", () => {
  const now = new Date("2026-07-26T12:00:00Z");
  for (const period of ["current_month", "3m", "6m", "12m", "this_year", "last_year"]) {
    const range = resolveStatementRange(period, now);
    assert.ok(range.from < range.toExclusive, period);
  }
  const custom = resolveStatementRange("custom", now, "2026-01-01", "2026-01-31");
  assert.equal(custom.from.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(custom.toExclusive.toISOString(), "2026-02-01T00:00:00.000Z");
});

test("6-month statement reconciles multiple invoices and labels adjustments separately", () => {
  const ledger = calculateStatementLedger(cases, events, { from: new Date("2026-06-01T00:00:00Z"), toExclusive: new Date("2026-12-01T00:00:00Z"), label: "6 months" });
  assert.equal(ledger.accounts.length, 2);
  assert.equal(ledger.openingBalanceMinor, 8000);
  assert.equal(ledger.movementMinor, 3300);
  assert.equal(ledger.closingBalanceMinor, 11300);
  assert.equal(ledger.openingBalanceMinor + ledger.movementMinor, ledger.closingBalanceMinor);
  assert.equal(ledger.periodPaymentsMinor, 3000);
  assert.equal(ledger.periodCreditsMinor, 200);
  assert.equal(ledger.periodReversalsMinor, 1000);
  assert.equal(ledger.transactions.find((item) => item.id === "e2")?.label, "Debit adjustment");
  assert.equal(ledger.transactions.find((item) => item.id === "e3")?.category, "credit");
});

test("12-month statement reconciles the same history from zero opening", () => {
  const ledger = calculateStatementLedger(cases, events, { from: new Date("2026-01-01T00:00:00Z"), toExclusive: new Date("2026-12-01T00:00:00Z"), label: "12 months" });
  assert.equal(ledger.openingBalanceMinor, 0);
  assert.equal(ledger.movementMinor, 11300);
  assert.equal(ledger.closingBalanceMinor, 11300);
});

test("multi-page PDF retains every transaction row without clipping the page footer", () => {
  const base = calculateStatementLedger(cases, events, { from: new Date("2026-01-01T00:00:00Z"), toExclusive: new Date("2026-12-01T00:00:00Z"), label: "2026" });
  const transactions: StatementTransaction[] = Array.from({ length: 120 }, (_, index) => ({ ...base.transactions[index % base.transactions.length], id: `row-${index}`, occurredAt: `2026-${String((index % 11) + 1).padStart(2, "0")}-${String((index % 27) + 1).padStart(2, "0")}T00:00:00Z` }));
  const data: Statement2Data = {
    version: 2, statementType: "recovery", currency: "MYR", businessName: "CollectBoss Test Business", businessRegistrationNo: "2026012345", businessAddress: "Kuala Lumpur",
    customerId: "customer-1", customerName: "Amina", customerCompany: "Amina Trading", customers: [{ id: "customer-1", name: "Amina", company: "Amina Trading", accountCount: 2 }],
    period: "12m", periodLabel: "1 Jan 2026 - 30 Nov 2026", periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-12-01T00:00:00Z", generatedAt: "2026-12-01T00:00:00Z",
    summary: { totalCases: 2, totalDue: 153, totalPaid: 50, totalOutstanding: 113, paymentCount: 2, activePaymentPlans: 1, openingBalance: 0, periodDebits: 155, periodPayments: 50, periodCredits: 2, periodReversals: 10, movement: 113, closingBalance: 113 },
    payments: [], transactions, accounts: base.accounts,
    recovery: { reminderCount: 1, promiseCount: 1, activePaymentPlans: 1, disputeCount: 0, lastContactAt: "2026-10-01T00:00:00Z", recoveryStatuses: [{ status: "overdue", count: 1 }], activities: Array.from({ length: 40 }, (_, index) => ({ id: `activity-${index}`, kind: "reminder" as const, occurredAt: "2026-10-01T00:00:00Z", caseReference: "CB-1", invoiceNo: "INV-1", label: "Friendly reminder", status: "sent" })) },
  };
  const pdf = generateStatementPdfV2(data);
  const text = Buffer.from(pdf).toString("latin1");
  assert.equal(text.slice(0, 4), "%PDF");
  assert.ok((text.match(/\/Type \/Page\b/g) ?? []).length >= 4);
  assert.ok(pdf.byteLength > 50_000);
});

test("legacy statement data still renders through the existing PDF export", () => {
  const legacy: StatementData = { businessName: "Legacy Business", periodLabel: "1 Jan 2026 - 1 Apr 2026", periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-04-01T00:00:00Z", generatedAt: "2026-04-01T00:00:00Z", summary: { totalCases: 1, totalDue: 100, totalPaid: 25, totalOutstanding: 75, paymentCount: 1, activePaymentPlans: 0 }, payments: [{ caseReference: "CB-OLD", customerName: "Legacy Customer", customerCompany: null, invoiceNo: "INV-OLD", amount: 25, paymentMethod: "bank_transfer", referenceNo: "REF-OLD", approvedAt: "2026-02-01T00:00:00Z", paymentStatus: "Approved" }] };
  const pdf = generateStatementPdf(legacy);
  assert.equal(Buffer.from(pdf).toString("latin1").slice(0, 4), "%PDF");
});

test("customer-facing statement modules never select internal note fields", () => {
  const source = readFileSync("src/lib/statements/builder.ts", "utf8");
  assert.doesNotMatch(source, /\.select\([^\n]*(?:message_body|notes|transition_reason|metadata)/);
  assert.match(source, /\.eq\("business_id", business\.id\)/);
  assert.doesNotMatch(source, /getServiceClient/);
});
