import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { primaryNavigation } from "../shared/navigation.ts";

const read = (path: string) => readFileSync(path, "utf8");

test("I05 keeps global capability out of primary navigation", () => {
  assert.deepEqual(primaryNavigation.map((item) => item.label), [
    "Dashboard",
    "Cases",
    "Payments",
    "Action Centre",
    "Reports",
  ]);
  const primaryLabels = primaryNavigation.map((item) => item.label).join(" ");
  for (const hidden of ["AI Centre", "Global Centre", "Integration Centre", "Compliance Centre", "Currencies", "Countries", "Xero", "QuickBooks", "Email"]) {
    assert.doesNotMatch(primaryLabels, new RegExp(hidden, "i"));
  }
});

test("international configuration and specialist integrations remain contextual in Settings", () => {
  const settings = read("src/components/pages/business-settings-page.tsx");
  assert.match(settings, /RegionSettingsPanel/);
  assert.match(settings, /AccountingIntegrationsPanel/);
  assert.match(settings, /EmailCommunicationsPanel/);
  assert.match(settings, /Payment data safety/);
  assert.doesNotMatch(settings, /Malaysian Compliance/);
});

test("Action Centre never combines unlike currencies", () => {
  const migration = read("supabase/migrations/20260829_action_priority_dashboard.sql");
  const panel = read("src/components/action-centre/action-centre-panel.tsx");
  assert.match(migration, /coalesce\(f\.case_currency,f\.currency\)/);
  assert.match(migration, /count\(distinct currency\)[\s\S]*then coalesce\(\(select sum\(amount_minor\)/);
  assert.match(migration, /group by currency/);
  assert.match(panel, /summary\.totalsByCurrency/);
  assert.match(panel, /formatMinorCurrency/);
});

test("Case Detail and communication workflows use tenant region presentation", () => {
  const files = [
    "src/components/pages/case-detail-page.tsx",
    "src/components/cases/payment-promise-card.tsx",
    "src/components/cases/dispute-card.tsx",
    "src/components/cases/financial-adjustments-card.tsx",
    "src/components/cases/unified-case-timeline.tsx",
    "src/components/cases/communication-activity.tsx",
  ];
  for (const path of files) {
    const source = read(path);
    assert.match(source, /useRegion|RegionSettings/);
    assert.doesNotMatch(source, /formatRM|currency:\s*["']MYR["']|["']en-MY["']/);
  }
  const detail = read(files[0]);
  assert.match(detail, /Outstanding/);
  assert.match(detail, /Next action/);
  assert.match(detail, /UnifiedCaseTimeline/);
});

test("Email templates use case currency and tenant date settings", () => {
  const route = read("src/app/api/cases/[caseId]/email/route.ts");
  assert.match(route, /resolveRegionSettings\(access\.business\)/);
  assert.match(route, /access\.caseData\.currency/);
  assert.match(route, /formatMinorCurrency/);
  assert.match(route, /formatCalendarDate/);
  assert.doesNotMatch(route, /currency:\s*["']MYR["']|["']en-MY["']/);
});

test("release documentation avoids unverified certification claims", () => {
  const report = read("docs/INTERNATIONAL_V1_RELEASE_REPORT.md");
  assert.doesNotMatch(report, /(?:GDPR|ISO 27001|SOC 2) certified/i);
  assert.match(report, /does not represent legal certification/i);
  assert.match(report, /Deferred/);
  assert.match(report, /Rollback/);
});
