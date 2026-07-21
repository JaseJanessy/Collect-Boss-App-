import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("Stripe mode is strictly separated between production and non-production", () => {
  const stripe = read("src/lib/stripe/server.ts");
  assert.match(stripe, /isProduction && stripeSecretKey\.startsWith\("sk_live_"\)/);
  assert.match(stripe, /!isProduction && stripeSecretKey\.startsWith\("sk_test_"\)/);
  assert.doesNotMatch(stripe, /!isProduction[\s\S]{0,140}sk_live_/);
});

test("checkout and portal expose only generic provider failures", () => {
  const checkout = read("src/app/api/billing/create-checkout-session/route.ts");
  const portal = read("src/app/api/billing/create-customer-portal-session/route.ts");
  assert.match(checkout, /Unable to start checkout\. Please try again\./);
  assert.match(portal, /Unable to open the billing portal\. Please try again\./);
  assert.doesNotMatch(checkout, /return err\(`Stripe error:/);
  assert.doesNotMatch(portal, /return err\(`Could not open billing portal:/);
});

test("refund authority is controlled outside the customer API", () => {
  const refundPolicy = read("docs/BILLING_REFUND_AUTHORITY.md");
  assert.match(refundPolicy, /does not expose a customer-facing refund API/);
  assert.match(refundPolicy, /Stripe lifecycle events remain the source of truth/);
});
