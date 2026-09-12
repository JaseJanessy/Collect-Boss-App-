import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import Stripe from "stripe";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const route = read("src/app/api/stripe/webhook/route.ts");
const service = read("src/lib/billing/service.ts");
const processor = read("src/lib/billing/stripe-events.ts");

test("Stripe signatures validate only the unchanged raw payload", () => {
  const stripe = new Stripe(["sk", "test", "webhook", "contract", "key"].join("_"));
  const payload = JSON.stringify({ id: "evt_contract", object: "event" });
  const secret = ["whsec", "webhook", "contract", "secret"].join("_");
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });

  assert.equal(stripe.webhooks.constructEvent(payload, signature, secret).id, "evt_contract");
  assert.throws(() => stripe.webhooks.constructEvent(payload, "t=1,v1=invalid", secret));
  assert.match(route, /request\.text\(\)/);
  assert.doesNotMatch(route, /request\.json\(\)/);
  assert.ok(route.indexOf("stripe.webhooks.constructEvent") < route.lastIndexOf("claimBillingEvent"));
});

test("event ID claim is atomic and a duplicate cannot reset processed state", () => {
  const migration = read("supabase/migrations/20260911_production_integrations_failure_recovery.sql");
  assert.match(service, /rpc\("billing_claim_event"/);
  assert.match(migration, /from public\.billing_events where stripe_event_id=p_stripe_event_id for update/i);
  assert.match(migration, /if v_processed or v_status in \('succeeded','dead_letter'\) then return 'done'/i);
  assert.match(migration, /on conflict\(stripe_event_id\) do nothing/i);
  assert.doesNotMatch(service, /billing_events"\)\.upsert/);
  assert.match(route, /if \(claim === "done" \|\| claim === "busy"\)/);
  assert.match(route, /failBillingEvent/);
  assert.match(route, /stripe_event_replay/);
});

test("subscription state is obtained from Stripe now, and mapping disagreements retry", () => {
  assert.match(processor, /stripe\.subscriptions\.retrieve\(subscriptionId\)/);
  assert.match(processor, /stripe\.subscriptions\.retrieve\(snapshot\.id\)/);
  assert.match(processor, /await stripe\.customers\.retrieve\(customerId\)/);
  assert.match(processor, /getBillingBusinessOwner\(businessId\)/);
  assert.match(processor, /isConfiguredPlanPriceId\(priceId\)/);
  assert.match(processor, /candidates\.some\(\(value\) => value !== businessId\)/);
  assert.match(processor, /validateMetadata\(sub\.metadata, resolved\)/);
  assert.match(processor, /validateMetadata\(customer\.metadata, resolved\)/);
});

test("retryable failures and refund/cancel outcomes are explicit and redacted", () => {
  assert.match(processor, /"customer\.subscription\.deleted"/);
  assert.match(processor, /event\.type === "charge\.refunded"/);
  assert.match(processor, /refund_recorded_no_entitlement_change/);
  assert.match(route, /return fail\(500, "Webhook processing failed\. Please retry\."\)/);
  assert.doesNotMatch(route, /return fail\([^\n]*err\.message/);
  assert.doesNotMatch(route, /console\.(?:error|warn|info)\([^\n]*rawBody/);
});
