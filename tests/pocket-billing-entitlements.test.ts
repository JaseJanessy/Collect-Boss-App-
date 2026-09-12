import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { invoiceLimit, offerGrantsSameBaseCapabilities, POCKET_LIMITS, POCKET_OFFERS } from "../src/lib/billing/pocket-policy.ts";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260913_pocket_entitlements_billing_usage.sql");
const processor = read("src/lib/billing/stripe-events.ts");
const proxy = read("src/proxy.ts");
const checkout = read("src/app/api/pocket/billing/checkout/route.ts");
const entitlementsRoute = read("src/app/api/pocket/entitlements/route.ts");

test("monthly and annual are integer-priced base offers with identical capabilities", () => {
  assert.equal(POCKET_OFFERS.pocket_monthly.amountMinor, 990);
  assert.equal(POCKET_OFFERS.pocket_annual.amountMinor, 9_900);
  assert.equal(offerGrantsSameBaseCapabilities("pocket_monthly"), true);
  assert.equal(offerGrantsSameBaseCapabilities("pocket_annual"), true);
  assert.equal(POCKET_OFFERS.pocket_monthly.kind, POCKET_OFFERS.pocket_annual.kind);
});

test("invoice tiers are 0, 30, and 60 with a hard maximum", () => {
  assert.equal(invoiceLimit(false, false), 0);
  assert.equal(invoiceLimit(true, false), 30);
  assert.equal(invoiceLimit(true, true), 60);
  assert.equal(POCKET_LIMITS.maximumInvoicesPerCycle, 60);
  assert.match(migration, /if v_used>=v_limit then raise exception 'LIMIT_REACHED'/i);
  assert.match(migration, /unique\(business_id,offer_key,cycle_start\)/i);
});

test("active-debt enforcement excludes settled and archived rows and rejects the 101st", () => {
  assert.match(migration, /v\.archived_at is null/i);
  assert.match(migration, /greatest\(v\.original_amount_minor\+v\.adjustments_minor-v\.paid_minor,0\)>0/i);
  assert.match(migration, /v\.status not in\('paid','void','written_off'\)/i);
  assert.match(migration, /v_count>=100 then raise exception 'LIMIT_REACHED'/i);
  assert.match(migration, /for update/i);
});

test("OCR is charged by source hash, retries are idempotent, and the 101st unique job is blocked", () => {
  assert.equal(POCKET_LIMITS.receiptProcessingPerCycle, 100);
  assert.match(migration, /'ocr:'\|\|coalesce\(v_hash,new\.evidence_id::text\)/i);
  assert.match(migration, /unique\(business_id,capability_key,cycle_start,operation_key\)/i);
  assert.match(migration, /if exists\(select 1 from public\.workspace_usage_events/i);
  assert.match(migration, /if v_used>=v_limit then raise exception 'LIMIT_REACHED'/i);
});

test("quota consumption serializes the counter and cancellation preserves read access", () => {
  assert.match(migration, /workspace_usage_counters[\s\S]*for update/i);
  assert.match(migration, /'pocket\.data\.read'[\s\S]*'enabled',true/i);
  assert.match(migration, /lifecycle_state='grace_read_only'/i);
  assert.doesNotMatch(migration, /delete from public\.(?:businesses|debtors|obligations|document_intakes)/i);
});

test("provider ordering, pack price verification, and Main API isolation are explicit", () => {
  assert.match(migration, /excluded\.last_provider_event_created_at>=workspace_subscription_items\.last_provider_event_created_at/i);
  assert.match(processor, /stripe\.checkout\.sessions\.listLineItems/);
  assert.match(processor, /pocketOfferFromPriceId/);
  assert.match(proxy, /PLAN_NOT_AUTHORISED/);
  assert.match(proxy, /!pocketOwnsApiPath\(pathname\)/);
  assert.match(checkout, /NEXT_PUBLIC_APP_ENV === "production"/);
  assert.match(checkout, /assertCompletePocketPriceConfiguration\(\)/);
  assert.match(entitlementsRoute, /requirePocketMobileBillingAccess/);
  assert.match(proxy, /"\/api\/pocket\/entitlements"/);
});
