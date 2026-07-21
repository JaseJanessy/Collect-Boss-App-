import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import Stripe from "stripe";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const route = read("src/app/api/stripe/webhook/route.ts");
const service = read("src/lib/billing/service.ts");

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
  assert.match(service, /from\("billing_events"\)\.insert/);
  assert.match(service, /insertError\.code !== "23505"/);
  assert.match(service, /return \(data as \{ processed: boolean \}\)\.processed \? "done" : "retry"/);
  assert.doesNotMatch(service, /billing_events"\)\.upsert/);
  assert.match(service, /from\("billing_events"\)\.update/);
  assert.match(route, /if \(claim === "done"\)/);
  assert.match(route, /processed=false, so Stripe retries it/);
});

test("subscription state is obtained from Stripe now, and mapping disagreements retry", () => {
  assert.match(route, /return stripe\.subscriptions\.retrieve\(subscriptionId\)/);
  assert.match(route, /await currentSubscription\(snapshot\.id, stripe\)/);
  assert.match(route, /await stripe\.customers\.retrieve\(customerId\)/);
  assert.match(route, /getBillingBusinessOwner\(businessId\)/);
  assert.match(route, /isConfiguredPlanPriceId\(priceId\)/);
  assert.match(route, /candidates\.some\(\(value\) => value !== businessId\)/);
  assert.match(route, /validateMetadata\(sub\.metadata, resolved\)/);
  assert.match(route, /validateMetadata\(customer\.metadata, resolved\)/);
});

test("retryable failures and refund/cancel outcomes are explicit and redacted", () => {
  assert.match(route, /case "customer\.subscription\.deleted"/);
  assert.match(route, /case "charge\.refunded"/);
  assert.match(route, /refund_recorded_no_entitlement_change/);
  assert.match(route, /return fail\(500, "Webhook processing failed\. Please retry\."\)/);
  assert.doesNotMatch(route, /return fail\([^\n]*err\.message/);
  assert.doesNotMatch(route, /console\.(?:error|warn|info)\([^\n]*rawBody/);
});
