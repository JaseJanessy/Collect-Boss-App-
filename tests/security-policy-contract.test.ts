import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const tenantPolicies = read("supabase/migrations/20260802_tenant_isolation_policy_hardening.sql");
const storagePolicies = read("supabase/migrations/20260803_storage_object_policy_hardening.sql");

test("tenant policy migration removes broad owner policies and constrains every mutation", () => {
  for (const policy of [
    "owners can manage own business",
    "debtors_owner_manage",
    "cases_owner_manage",
    "owners can manage own evidence",
    "owners can manage own reminders",
    "owners can manage own access requests",
  ]) {
    assert.match(tenantPolicies, new RegExp(`drop policy if exists "${policy}"`));
  }
  assert.doesNotMatch(tenantPolicies, /for all to authenticated/i);
  assert.match(tenantPolicies, /for update to authenticated[\s\S]*?with check/i);
  assert.doesNotMatch(tenantPolicies, /owns_business/i);
});

test("storage policy migration keeps sensitive buckets private and excludes client proof writes", () => {
  for (const bucket of ["payment-proofs", "business-assets", "evidence-files"]) {
    assert.match(storagePolicies, new RegExp(`'${bucket}'`));
  }
  assert.match(storagePolicies, /do update set public = false/i);
  assert.match(storagePolicies, /storage\.foldername\(name\)/i);
  assert.match(storagePolicies, /create policy "business_assets_owner_insert"[\s\S]*?for insert/i);
  assert.doesNotMatch(storagePolicies, /create policy "(?:payment_proofs|evidence_files)[^"]*"[\s\S]{0,250}?for insert/i);
});

test("manual payment proof uploads use the authenticated evidence endpoint", () => {
  const page = read("src/components/pages/payments/record-payment-page.tsx");
  const legacyClient = read("src/lib/db/payments-client.ts");
  assert.match(page, /\/api\/cases\/\$\{encodeURIComponent\(c\.id\)\}\/evidence/);
  assert.doesNotMatch(legacyClient, /storage\.from\(PROOF_BUCKET\)\.upload/);
  assert.doesNotMatch(legacyClient, /export async function uploadProofFile/);
});
