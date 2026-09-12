import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260821_business_verification_abuse_controls.sql");
const profileRoute = read("src/app/api/profile/route.ts");
const publicLinkRoute = read("src/app/api/cases/[caseId]/public-links/route.ts");
const debtorPage = read("src/components/pages/payments/debtor-payment-page.tsx");
const reportRoute = read("src/app/api/public/pay/[token]/suspicious/route.ts");
const tenantReports = read("src/app/api/abuse-reports/route.ts");

test("business identity and verification states are additive and owner writes cannot self-verify", () => {
  for (const field of [
    "industry", "verification_state", "verification_submitted_at", "verified_at",
    "verification_public_note", "payment_links_restricted_until",
  ]) {
    assert.match(migration, new RegExp(`add column if not exists ${field}`));
  }
  for (const state of ["unverified", "pending", "verified", "rejected", "restricted"]) {
    assert.match(migration, new RegExp(`'${state}'`));
  }
  assert.match(migration, /business_profile_verification_guard/);
  assert.match(migration, /new\.verification_state:='unverified'/);
  assert.match(migration, /business_verification_decide[\s\S]*to service_role/);
  assert.doesNotMatch(profileRoute, /verification_state:\s*input/);
  assert.match(debtorPage, /verificationState === "verified"/);
  assert.match(debtorPage, /not verified by CollectBoss/);
});

test("high-risk industries use configurable additional review instead of blanket suspicion", () => {
  assert.match(migration, /create table if not exists public\.business_risk_policies/);
  assert.match(migration, /\('financing_money_lending','high',true,true,true/);
  assert.match(migration, /\('financial_services','elevated',true,false,true/);
  assert.match(migration, /\('general','standard',false,false,false/);
  assert.match(migration, /requires_licence_reference/);
  assert.match(migration, /Required licence review evidence is missing/);
  assert.match(migration, /business_risk_policy_audit_trigger/);
  assert.match(migration, /business_risk_policy_payment_link_reconcile_trigger/);
});

test("payment-link restrictions are database-enforced and revoke active capabilities", () => {
  assert.match(migration, /enforce_public_payment_token_business_controls/);
  assert.match(migration, /before insert or update[\s\S]*on public\.public_access_tokens/);
  assert.match(migration, /update public\.public_access_tokens set revoked_at/);
  assert.match(publicLinkRoute, /business_payment_link_access/);
  assert.match(publicLinkRoute, /additional_review_required/);
  assert.match(publicLinkRoute, /verification_status", "verified"/);
});

test("debtor report reasons feed tenant and platform review queues", () => {
  for (const reason of [
    "do_not_recognise_business", "do_not_recognise_amount", "wrong_payment_details",
    "suspicious_payment_request", "suspected_illegal_lending", "other",
  ]) {
    assert.match(reportRoute, new RegExp(reason));
    assert.match(migration, new RegExp(`'${reason}'`));
  }
  assert.match(migration, /insert into public\.notifications/);
  assert.match(migration, /insert into public\.action_centre_items/);
  assert.match(migration, /insert into public\.platform_abuse_review_queue/);
  assert.match(migration, /immediate_illegal_lending_restriction/);
  assert.match(tenantReports, /eq\("business_id", auth\.businessId\)/);
});

test("review decisions and policy changes retain an audit trail with tenant/platform separation", () => {
  assert.match(migration, /create table if not exists public\.business_verification_events/);
  assert.match(migration, /create table if not exists public\.payment_access_report_events/);
  assert.match(migration, /create table if not exists public\.business_risk_policy_events/);
  assert.match(migration, /audience text not null check \(audience in \('tenant','platform'\)\)/);
  assert.match(migration, /payment_access_report_events_owner_read[\s\S]*audience='tenant'/);
  assert.match(migration, /platform_abuse_review_queue enable row level security/);
  assert.doesNotMatch(migration, /create policy "[^"]+"[\s\S]{0,100}platform_abuse_review_queue/);
});
