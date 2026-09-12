import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  businessExportDatasets,
  normalizeExportDatasets,
} from "../src/lib/exports/selection.ts";

const read = (path: string) => readFileSync(path, "utf8");

test("business data export selection is explicit, deterministic and rejects unknown datasets", () => {
  assert.deepEqual(normalizeExportDatasets(undefined), businessExportDatasets);
  assert.deepEqual(
    normalizeExportDatasets(["payments", "customers", "payments"]),
    ["customers", "payments"],
  );
  assert.throws(() => normalizeExportDatasets([]), /at least one/);
  assert.throws(() => normalizeExportDatasets(["customers", "audit_logs"]), /not supported/);
});

test("R18 export is permission-gated, tenant-scoped, private and audited before download", () => {
  const route = read("src/app/api/exports/business-data/route.ts");
  const service = read("src/lib/exports/business-data.ts");
  const reportRoute = read("src/app/api/reports/export/route.ts");

  assert.match(route, /requireTenantPermission\("export\.run"\)/);
  assert.match(route, /await appendSensitiveAudit\(/);
  assert.match(route, /action: "business_data\.exported"/);
  assert.match(route, /row_counts: bundle\.manifest\.row_counts/);
  assert.match(route, /"Cache-Control": "private, no-store"/);
  assert.ok(route.indexOf("await appendSensitiveAudit") < route.indexOf("return new Response"));

  for (const table of ["debtors", "customer_accounts", "obligations", "cases", "communication_activities"]) {
    assert.match(service, new RegExp(`from\\("${table}"\\)[\\s\\S]*?\\.eq\\("business_id", business\\.id\\)`));
  }
  assert.match(service, /const caseIds = scopedCases\.map/);
  assert.match(service, /loadRowsForCaseIds\([\s\S]*?"payments"[\s\S]*?caseIds/);
  assert.match(service, /loadRowsForCaseIds\([\s\S]*?"statements"[\s\S]*?caseIds/);
  assert.doesNotMatch(service, /proof_url/);

  assert.match(reportRoute, /action: "report\.exported"/);
  assert.match(reportRoute, /requireTenantPermission\("export\.run"\)/);
});

test("R18 entity model is optional, preserves business ownership and blocks cross-tenant assignment", () => {
  const migration = read("supabase/migrations/20260825_data_export_multi_entity_readiness.sql");
  const schema = read("supabase/schema.sql");
  const rls = read("src/lib/supabase/rls.sql");

  for (const sql of [migration, schema]) {
    assert.match(sql, /create table if not exists (public\.)?organizations/);
    assert.match(sql, /create table if not exists (public\.)?organization_business_relationships/);
    assert.match(sql, /create table if not exists (public\.)?business_entities/);
    assert.match(sql, /organization_id uuid/);
    assert.match(sql, /parent_entity_id uuid/);
    assert.match(sql, /foreign key \(organization_id,business_id\)/);
    assert.match(sql, /foreign key \(parent_entity_id,business_id\)/);
    for (const constraint of [
      "customer_accounts_business_entity_tenant_fk",
      "obligations_business_entity_tenant_fk",
      "cases_business_entity_tenant_fk",
      "receiving_accounts_business_entity_tenant_fk",
    ]) {
      assert.match(sql, new RegExp(`${constraint}[\\s\\S]*?foreign key \\(business_entity_id,business_id\\)`));
    }
  }

  assert.match(migration, /business_id columns remain the authoritative financial ownership key/);
  assert.doesNotMatch(migration, /insert into public\.business_entities/i);
  assert.doesNotMatch(migration, /update public\.(cases|customer_accounts|obligations|receiving_accounts)/i);
  assert.match(rls, /organizations_member_read[\s\S]*?has_business_permission\(relationship\.business_id,'case\.read'\)/);
  assert.match(rls, /business_entities_member_read[\s\S]*?has_business_permission\(business_id,'case\.read'\)/);
  assert.match(rls, /No browser mutation policy exists/);
});

test("business data export remains available when analytics entitlement is disabled", () => {
  const page = read("src/components/pages/reports-page.tsx");
  const button = read("src/components/exports/business-data-export-button.tsx");
  assert.match(page, /if \(!entitlement\?\.reports_enabled\)[\s\S]*?<BusinessDataExportButton \/>[\s\S]*?<UpgradePrompt/);
  assert.match(button, /fetch\("\/api\/exports\/business-data"/);
  assert.match(button, /method: "POST"/);
});
