import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260822_roles_permissions_audit.sql");

test("R15 backfills owners and defines the five tenant roles", () => {
  assert.match(migration, /role in \('owner','admin','manager','staff','viewer'\)/i);
  assert.match(migration, /insert into public\.business_memberships[\s\S]*select b\.id,b\.owner_id/i);
  assert.match(migration, /business_memberships_active_user_one_tenant/i);
});

test("permissions are database-enforced and manager financial approvals are configurable", () => {
  assert.match(migration, /has_business_permission\(p_business_id uuid,p_permission text\)/i);
  assert.match(migration, /manager_can_approve_settlements/i);
  assert.match(migration, /manager_can_approve_write_offs/i);
  assert.match(migration, /cases_role_update[\s\S]*has_business_permission\(business_id,'case\.manage'\)/i);
  assert.match(read("src/app/api/cases/[caseId]/route.ts"), /write_off\.approve[\s\S]*settlement\.approve[\s\S]*payment\.approve/i);
});

test("audit records carry sensitive context and are immutable", () => {
  for (const field of ["entity_type", "entity_id", "before_summary", "after_summary", "actor_role", "request_id", "session_id", "request_metadata"]) {
    assert.match(migration, new RegExp(field, "i"));
  }
  assert.match(migration, /before update or delete on public\.audit_logs/i);
  assert.match(migration, /raise exception 'Audit records are immutable'/i);
  assert.doesNotMatch(migration, /create policy[^;]+audit_logs[^;]+for (update|delete)/i);
});

test("team, role-setting and audit APIs use central server permission checks", () => {
  assert.match(read("src/app/api/team-members/route.ts"), /requireTenantPermission\("users\.manage"\)/);
  assert.match(read("src/app/api/role-settings/route.ts"), /requireTenantPermission\("users\.manage"\)/);
  assert.match(read("src/app/api/audit-log/route.ts"), /requireTenantPermission\("audit\.read"\)/);
  assert.match(read("src/lib/receiving-accounts/server.ts"), /requireTenantPermission\("receiving_accounts\.manage"\)/);
});
