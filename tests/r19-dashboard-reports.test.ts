import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("R19 dashboards consume the server summary instead of raw case and payment collections", () => {
  for (const path of ["src/components/pages/home-dashboard.tsx", "src/components/pages/home-mobile.tsx"]) {
    const source = read(path);
    assert.match(source, /useReportSummary/);
    assert.doesNotMatch(source, /useCases|usePayments/);
  }
  const service = read("src/lib/reports/service.ts");
  assert.match(service, /\.eq\("business_id", businessId\)/);
  assert.match(service, /SUMMARY_CACHE_TTL_MS/);
  assert.match(service, /Financial reconciliation detected stored-balance drift/);
});

test("Receivables Pulse exposes every required range and accessible chart meaning", () => {
  const pulse = read("src/components/analytics/receivables-pulse.tsx");
  for (const range of ["7D", "30D", "3M", "6M", "1Y"]) assert.match(pulse, new RegExp(`\\"${range}\\"`));
  assert.match(pulse, /role="img"/);
  assert.match(pulse, /aria-label/);
  assert.match(pulse, /slice\(0, compact \? 3 : 8\)/);
  assert.match(pulse, /linearGradient/);
});

test("Reports 2.0 labels projections and fair team context without invented values", () => {
  const dashboard = read("src/components/pages/home-dashboard.tsx");
  const reports = read("src/components/pages/reports-page.tsx");
  assert.match(dashboard, /Projection .* not a guarantee/);
  assert.match(dashboard, /Projection hidden until/);
  for (const section of ["Outstanding Trend", "Recovery Performance", "Aging", "Top Customers", "Promise Performance", "Payment Plan Performance", "Closure Outcomes", "Fair Team Performance"]) {
    assert.match(reports, new RegExp(section));
  }
  assert.match(reports, /does not rank staff by debt value/);
  assert.match(reports, /No FX conversion/);
});

test("mobile case puts outstanding, progress, next action and timeline in its priority summary", () => {
  const source = read("src/components/pages/case-detail-page.tsx");
  assert.match(source, /Money-first mobile case summary/);
  assert.match(source, /"Outstanding"/);
  assert.match(source, /Next action/);
  assert.match(source, /openSection\("activity"\)/);
  assert.match(source, /% paid/);
});
