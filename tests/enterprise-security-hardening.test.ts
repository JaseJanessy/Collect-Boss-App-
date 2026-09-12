import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

function filesUnder(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path.replaceAll("\\", "/")];
  });
}

const migration = read("supabase/migrations/20260910_enterprise_security_hardening.sql");

test("public capabilities carry a database-enforced immutable tenant scope", () => {
  assert.match(migration, /public_access_tokens[\s\S]*add column if not exists business_id uuid/i);
  assert.match(migration, /update public\.public_access_tokens token[\s\S]*case_row\.business_id/i);
  assert.match(migration, /new\.business_id<>v_case_business[\s\S]*tenant mismatch/i);
  assert.match(migration, /payment_plan_id[\s\S]*plan\.case_id=new\.case_id/i);
  assert.match(migration, /receiving_account_id[\s\S]*account\.business_id=new\.business_id/i);
  assert.match(migration, /public_rotate_access_token[\s\S]*v_old\.business_id/i);
  const service = read("src/lib/public-access/service.ts");
  assert.match(service, /select\("id, business_id, purpose/);
  assert.match(service, /eq\("business_id", token\.business_id\)/);
});

test("public capability routes have shared fail-closed abuse controls", () => {
  const routes = filesUnder("src/app/api/public").filter((path) => path.endsWith("/route.ts"));
  assert.ok(routes.length >= 9);
  for (const route of routes) {
    assert.match(read(route), /enforcePublicRateLimit/, `${route} must use the shared limiter`);
  }
  assert.match(migration, /create table if not exists public\.security_rate_limit_buckets/i);
  assert.match(migration, /grant execute on function public\.security_rate_limit_consume[\s\S]*to service_role/i);
  assert.doesNotMatch(migration, /grant execute on function public\.security_rate_limit_consume[^;]+to (anon|authenticated)/i);
});

test("sensitive file reads re-authorize through same-origin routes without storage signatures", () => {
  const sensitive = [
    "src/app/api/cases/[caseId]/evidence/[evidenceId]/route.ts",
    "src/app/api/document-intakes/[intakeId]/evidence/[evidenceId]/preview/route.ts",
    "src/app/api/payment-submissions/route.ts",
    "src/app/api/payment-submissions/[id]/review/route.ts",
    "src/app/api/receiving-accounts/[id]/qr/route.ts",
    "src/lib/public-access/service.ts",
  ].map(read).join("\n");
  assert.doesNotMatch(sensitive, /createSignedUrl/);
  assert.match(sensitive, /secureStoredFileResponse/);
  assert.match(sensitive, /serve=1/);
  assert.match(sensitive, /asset=proof/);
  assert.match(sensitive, /asset=qr/);
  assert.match(migration, /drop policy if exists "payment_proofs_owner_read"/i);
});

test("privileged public-link actions use a central role and explicit tenant predicate", () => {
  for (const path of [
    "src/app/api/cases/[caseId]/public-links/route.ts",
    "src/app/api/public-links/[id]/rotate/route.ts",
    "src/app/api/public-links/[id]/revoke/route.ts",
  ]) {
    const route = read(path);
    assert.match(route, /requireTenantPermission\("public_link\.manage"\)/);
    assert.match(route, /business_id|businessId/);
    assert.match(route, /appendSensitiveAudit/);
  }
});

test("audit rows are immutable and new events are tenant hash chained", () => {
  const rolesMigration = read("supabase/migrations/20260822_roles_permissions_audit.sql");
  assert.match(rolesMigration, /before update or delete on public\.audit_logs/i);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('audit:'\|\|new\.business_id::text,0\)\)/i);
  assert.match(migration, /new\.previous_event_hash:=v_previous/i);
  assert.match(migration, /new\.event_hash:=encode\(digest/i);
});

test("route bodies are not passed wholesale into database mutations", () => {
  const routes = filesUnder("src/app/api").filter((path) => path.endsWith("/route.ts"));
  for (const path of routes) {
    const source = read(path);
    assert.doesNotMatch(source, /\.(?:insert|update)\(\s*(?:body|requestBody|input\.data)\s*\)/,
      `${path} appears vulnerable to mass assignment`);
  }
});

test("schema and RLS sources contain the Prompt 21 service-only boundary", () => {
  for (const path of ["supabase/schema.sql", "src/lib/supabase/rls.sql"]) {
    const sql = read(path);
    assert.match(sql, /security_rate_limit_buckets/i);
    assert.match(sql, /public_access_tokens[\s\S]*business_id/i);
    assert.match(sql, /payment_proofs_owner_read/i);
  }
  const serviceClient = read("src/lib/supabase/service-client.ts");
  assert.match(serviceClient, /isDeploymentEnvironment[\s\S]*SUPABASE_SERVICE_ROLE_KEY is required/);
});
