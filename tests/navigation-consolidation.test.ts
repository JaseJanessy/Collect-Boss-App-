import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";
import {
  activePrimaryNavigation,
  primaryNavigation,
  protectedPageRules,
  secondaryNavigation,
} from "../shared/navigation.ts";

const read = (path: string) => readFileSync(path, "utf8");

test("one source defines the five required primary destinations", () => {
  assert.deepEqual(primaryNavigation.map((item) => item.label), [
    "Dashboard", "Cases", "Payments", "Action Centre", "Reports",
  ]);
  assert.deepEqual(primaryNavigation.map((item) => item.href), [
    "/", "/cases", "/payments", "/actions", "/reports",
  ]);
  assert.equal(new Set(primaryNavigation.map((item) => item.href)).size, 5);
});

test("route ownership selects one primary destination without overlap", () => {
  const ownership = {
    "/": "dashboard",
    "/cases/CB-1": "cases",
    "/debtors": "cases",
    "/documents": "cases",
    "/payments/record/CB-1": "payments",
    "/actions": "action-centre",
    "/operations": "action-centre",
    "/notifications": "action-centre",
    "/reports": "reports",
    "/statements": "reports",
  } as const;
  for (const [path, owner] of Object.entries(ownership)) {
    assert.equal(activePrimaryNavigation(path)?.id, owner, `${path} should belong to ${owner}`);
  }
});

test("desktop, responsive web and native mobile consume the shared source", () => {
  for (const path of [
    "src/components/shells/dashboard-shell.tsx",
    "src/components/shells/mobile-shell.tsx",
    "src/components/pages/more-page.tsx",
  ]) {
    assert.match(read(path), /@collectboss\/navigation/);
  }
  assert.match(read("src/components/shells/dashboard-shell.tsx"), /aria-label="Primary navigation"/);
  assert.match(read("src/components/shells/mobile-shell.tsx"), /aria-current=/);
  const nativeNavigation = read("mobile/src/components/collectboss-app.tsx");
  assert.match(nativeNavigation, /shared\/navigation/);
  assert.match(nativeNavigation, /accessibilityRole="tablist"/);
  assert.match(nativeNavigation, /primaryNavigation\.filter\(\(item\) => navigationItemIsVisible/);
  assert.match(read("mobile/src/lib/collectboss.ts"), /rpc\('has_business_permission'/);
});

test("secondary destinations live in More or Settings and remain permission labelled", () => {
  const byId = new Map<string, (typeof secondaryNavigation)[number]>(secondaryNavigation.map((item) => [item.id, item]));
  for (const id of ["debtors", "documents", "statements", "notifications", "team", "billing", "integrations", "settings"]) {
    assert.ok(byId.has(id), `${id} should remain reachable as a secondary destination`);
  }
  for (const id of ["team", "billing", "integrations"]) {
    const item = byId.get(id);
    assert.ok(item && "permission" in item && item.permission, `${id} must remain permission controlled`);
  }
});

test("privileged direct page routes are covered by server permission checks", () => {
  const rules = new Map(protectedPageRules.map((rule) => [rule.prefix, rule.permission]));
  assert.equal(rules.get("/billing"), "billing.manage");
  assert.equal(rules.get("/payments/account"), "receiving_accounts.manage");
  assert.equal(rules.get("/operations"), "case.manage");
  assert.equal(rules.get("/reports"), "report.read");
  assert.equal(rules.get("/statements"), "report.read");

  const proxy = read("src/proxy.ts");
  assert.match(proxy, /requiredPermissionForPath\(pathname\)/);
  assert.match(proxy, /rpc\("has_business_permission"/);
  assert.match(proxy, /searchParams\.set\("access", "denied"\)/);
});

test("deep-linked specialist pages remain present", () => {
  for (const path of [
    "src/app/actions/page.tsx",
    "src/app/documents/page.tsx",
    "src/app/payments/page.tsx",
    "src/app/statements/page.tsx",
    "src/app/billing/page.tsx",
    "src/app/debtors/page.tsx",
    "src/app/notifications/page.tsx",
    "src/app/operations/page.tsx",
    "src/app/evidence/[caseId]/page.tsx",
  ]) assert.equal(statSync(path).isFile(), true, `${path} should remain available`);
});
