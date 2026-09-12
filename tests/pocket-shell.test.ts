import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

import { pocketDestinations, pocketPrimaryNavigation } from "../shared/pocket-navigation.ts";

const read = (path: string) => readFileSync(path, "utf8");

test("Pocket has a separate guarded App Router shell without moving Main", () => {
  for (const path of [
    "src/app/pocket/layout.tsx",
    "src/app/pocket/page.tsx",
    "src/app/pocket/loading.tsx",
    "src/app/pocket/error.tsx",
    "src/app/pocket/manifest.ts",
    "src/app/pocket/manifest.webmanifest/route.ts",
    "src/app/pocket/customers/page.tsx",
    "src/app/pocket/add/page.tsx",
    "src/app/pocket/activity/page.tsx",
    "src/app/pocket/more/page.tsx",
    "src/app/page.tsx",
  ]) assert.equal(statSync(path).isFile(), true, `${path} should exist`);

  const layout = read("src/app/pocket/layout.tsx");
  assert.match(layout, /requireWorkspaceContext\("pocket"\)/);
  assert.match(layout, /productType !== "pocket"/);
  assert.match(layout, /\/pocket\/manifest\.webmanifest/);
  assert.match(read("src/app/pocket/manifest.ts"), /pocket-icon-512\.png/);
  const manifestRoute = read("src/app/pocket/manifest.webmanifest/route.ts");
  assert.match(manifestRoute, /application\/manifest\+json/);
  assert.match(manifestRoute, /pocketManifest\(\)/);
  assert.match(read("src/app/page.tsx"), /redirect\("\/pocket"\)/);
  assert.match(read("src/proxy.ts"), /my_workspace_context/);
  assert.match(read("src/proxy.ts"), /productOwnsProtectedPath/);
});

test("Pocket navigation and placeholders follow the locked vocabulary", () => {
  assert.deepEqual(pocketPrimaryNavigation.map((item) => item.label), ["Home", "Customers", "Add", "Activity", "More"]);
  assert.deepEqual(pocketDestinations.map((item) => item.label), [
    "Add Debt", "Record Payment", "Scan Receipt", "Who Owes Me", "Due Today",
    "Customer Profiles", "Reminders", "Receipts", "Basic Reports", "Settings", "Plan & Limits", "Simple Invoices", "Upgrade to Solo",
  ]);
  const ui = [
    ...["src/app/pocket/page.tsx", "src/app/pocket/add/page.tsx", "src/app/pocket/activity/page.tsx", "src/app/pocket/more/page.tsx"],
    ...["src/components/pocket/pocket-shell.tsx", "src/components/pocket/pocket-placeholder.tsx"],
  ].map(read).join("\n");
  for (const forbidden of ["Receivable", "Debtor", "Reconciliation", "Evidence Pack", "Settlement Workflow", "Action Centre"]) {
    assert.doesNotMatch(ui, new RegExp(forbidden, "i"));
  }
});

test("web and Expo shells include responsive and accessibility foundations", () => {
  const web = read("src/components/pocket/pocket-shell.tsx");
  assert.match(web, /lg:flex/);
  assert.match(web, /lg:hidden/);
  assert.match(web, /aria-label="Pocket primary navigation"/);
  assert.match(web, /focus-visible:ring/);
  assert.match(web, /motion-reduce/);
  assert.match(web, /CollectBossPocketWordmark/);
  assert.match(web, /data-pocket-theme/);

  const mobile = read("mobile/src/products/pocket/pocket-app.tsx");
  assert.match(mobile, /width >= 768/);
  assert.match(mobile, /accessibilityRole="tablist"/);
  assert.match(mobile, /pocketPrimaryNavigation/);
  assert.match(mobile, /CollectBossPocketWordmark/);
  const app = JSON.parse(read("mobile/app.json")) as { expo: { orientation: string; ios: { bundleIdentifier: string; supportsTablet: boolean }; android: { package: string } } };
  assert.equal(app.expo.ios.supportsTablet, true);
  assert.equal(app.expo.orientation, "default");
  assert.equal(app.expo.ios.bundleIdentifier, "com.collectboss.mobile");
  assert.equal(app.expo.android.package, "com.collectboss.mobile");
});

test("workspace state migration is additive, tenant scoped, and unapplied by application code", () => {
  const migration = read("supabase/migrations/20260912_workspace_product_state.sql");
  assert.match(migration, /workspace_product_states/);
  assert.match(migration, /coalesce\(wps\.product_type, 'main'\)/);
  assert.match(migration, /has_business_permission\(business_id, 'case.read'\)/);
  assert.match(migration, /revoke insert, update, delete/);
  assert.match(migration, /my_workspace_context\(\)/);
  assert.doesNotMatch(migration, /create project|service_role_key/i);
  assert.match(migration, /Rollback/);
});

test("mobile selects one shell from the authenticated server context", () => {
  const gate = read("mobile/src/components/product-gate.tsx");
  assert.match(gate, /loadWorkspaceContext\(session\.access_token\)/);
  assert.match(gate, /productType === 'pocket'/);
  assert.match(gate, /<CollectBossApp/);
  assert.match(read("mobile/App.tsx"), /<MobileProductGate/);
  assert.match(read("src/app/api/workspace/context/route.ts"), /requireMobilePermission\(request, "case.read"\)/);
  const appConfig = read("mobile/app.config.js");
  assert.match(appConfig, /EXPO_PUBLIC_PRODUCT_BRAND === 'pocket'/);
  assert.match(appConfig, /pocket-icon\.png/);
  assert.match(appConfig, /pocket-splash-wordmark\.png/);
});
