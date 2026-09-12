import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260826_i01_international_locale_foundation.sql");

test("I01 preserves and records the legacy Malaysia defaults", () => {
  for (const value of ["country_code = 'MY'", "locale = 'en-MY'", "timezone = 'Asia/Kuala_Lumpur'", "default_currency = 'MYR'", "legacy_malaysia_v1"]) {
    assert.match(migration, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.doesNotMatch(migration, /update public\.cases[\s\S]+amount|update public\.payments[\s\S]+amount/i);
});

test("payment plans inherit tenant region and scheduler dates are tenant-local", () => {
  assert.match(migration, /payment_plan_apply_region_defaults/);
  assert.match(migration, /timezone\(v_timezone, now\(\)\)::date/);
  assert.match(migration, /timezone\(v_row\.timezone, now\(\)\)::date/);
  assert.doesNotMatch(
    migration.slice(migration.indexOf("create or replace function public.payment_plan_run_scheduler")),
    /RM %s|timezone\('Asia\/Kuala_Lumpur'/,
  );
});

test("region settings are tenant-scoped and Owner/Admin managed", () => {
  const route = read("src/app/api/region-settings/route.ts");
  assert.match(route, /requireTenantPermission\("case\.read"\)/);
  assert.match(route, /requireTenantPermission\("settings\.sensitive\.manage"\)/);
  assert.match(route, /\.eq\("id", access\.businessId\)/);
  assert.match(route, /appendSensitiveAudit/);
});

test("I01 adds no country or locale top-level navigation", () => {
  const desktop = read("src/components/shells/dashboard-shell.tsx");
  const mobile = read("src/components/shells/mobile-shell.tsx");
  assert.doesNotMatch(desktop, /label:\s*["'](?:Countries|Locale|Compliance)["']/i);
  assert.doesNotMatch(mobile, /label:\s*["'](?:Countries|Locale|Compliance)["']/i);
});

test("country capabilities remain adapters and make no legal correctness claim", () => {
  const registry = read("src/lib/international/registry.ts");
  const panel = read("src/components/settings/region-settings-panel.tsx");
  assert.match(registry, /paymentCapabilityKeys/);
  assert.match(registry, /contactPolicyHintKeys/);
  assert.match(registry, /legalHandoffWordingKey/);
  assert.match(panel, /does not certify legal or compliance correctness/i);
});
