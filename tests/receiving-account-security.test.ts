import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { isSelectableReceivingAccount, maskAccountIdentifier } from "../src/lib/receiving-accounts/security.ts";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260805_receiving_account_security.sql");

test("account identifiers are masked and disabled/rejected destinations are not selectable", () => {
  assert.equal(maskAccountIdentifier("1234 5678 9012"), "********9012");
  assert.equal(isSelectableReceivingAccount({ is_active: true, verification_status: "unverified" }), true);
  assert.equal(isSelectableReceivingAccount({ is_active: false, verification_status: "verified" }), false);
  assert.equal(isSelectableReceivingAccount({ is_active: true, verification_status: "rejected" }), false);
});

test("receiving account migration preserves rows and removes direct mutation policies", () => {
  assert.doesNotMatch(migration, /delete\s+from\s+public\.receiving_accounts/i);
  assert.match(migration, /drop policy if exists "receiving_accounts: owner insert"/i);
  assert.match(migration, /create policy "receiving_accounts: owner read"[\s\S]*for select to authenticated/i);
  assert.doesNotMatch(migration, /create policy "receiving_accounts:[^"]+"[\s\S]{0,100}for (insert|update|delete)/i);
});

test("secure mutations verify ownership, audit redacted summaries, and guard case selection", () => {
  assert.match(migration, /owner_id=p_actor_id/i);
  assert.match(migration, /receiving_account\.updated/);
  assert.match(migration, /masked_display/);
  assert.doesNotMatch(migration, /jsonb_build_object\([^)]*account_number/i);
  assert.match(migration, /cases_receiving_account_guard/);
  assert.match(migration, /ra\.business_id=new\.business_id[\s\S]*ra\.is_active/);
});

test("QR bucket is private and QR paths are tenant/account scoped", () => {
  assert.match(migration, /'receiving-account-qr','receiving-account-qr',false/);
  assert.match(migration, /p_qr_object_path not like p_business_id::text\|\|'\/'\|\|p_account_id::text/);
  const route = read("src/app/api/receiving-accounts/[id]/qr/route.ts");
  assert.match(route, /secureStoredFileResponse/);
  assert.match(route, /\.download\(path\)/);
  assert.doesNotMatch(route, /createSignedUrl/);
  assert.match(route, /eq\("business_id", auth\.business\.id\)/);
  assert.match(route, /inspectQrImage/);
});
