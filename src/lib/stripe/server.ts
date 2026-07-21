/**
 * CollectBoss — Stripe server-side client
 *
 * IMPORTANT: This module must only be imported in:
 *  • API Route Handlers  (src/app/api/**\/route.ts)
 *  • Server Components   (async components, server actions)
 *
 * Never import this in "use client" components — the STRIPE_SECRET_KEY
 * would be bundled into the client bundle and exposed to the browser.
 */

import "server-only";

import Stripe from "stripe";
import { isProduction } from "@/lib/supabase/client";

// ─── Initialisation ───────────────────────────────────────────────────────────

const stripeSecretKey = process.env.STRIPE_SECRET_KEY ?? "";

/**
 * True when STRIPE_SECRET_KEY is present and appropriate for this environment.
 * A production deployment must never be able to create subscriptions with a
 * Stripe test key, even when its other configuration is otherwise valid.
 */
export const isStripeConfigured =
  (isProduction && stripeSecretKey.startsWith("sk_live_")) ||
  (!isProduction && stripeSecretKey.startsWith("sk_test_"));

let _stripe: Stripe | null = null;

/** Returns the Stripe client, or null when STRIPE_SECRET_KEY is not set. */
export function getStripeServer(): Stripe | null {
  if (!isStripeConfigured) return null;
  if (!_stripe) {
    _stripe = new Stripe(stripeSecretKey, {
      typescript: true,
    });
  }
  return _stripe;
}

// ─── Plan → Stripe price ID mapping ─────────────────────────────────────────
// Prices come exclusively from server-side env vars.
// The client must NEVER be able to influence the price ID.

const ALLOWED_PLAN_SLUGS = ["starter", "boss", "pro"] as const;
export type CheckoutPlanSlug = (typeof ALLOWED_PLAN_SLUGS)[number];

const PRICE_ENV_MAP: Record<CheckoutPlanSlug, string> = {
  starter: process.env.STRIPE_PRICE_STARTER ?? "",
  boss:    process.env.STRIPE_PRICE_BOSS    ?? "",
  pro:     process.env.STRIPE_PRICE_PRO     ?? "",
};

/**
 * Returns the Stripe Price ID for a plan, validated server-side.
 *
 * @throws Never — returns null instead, so callers can return a 503.
 */
export function getPriceId(planSlug: string): string | null {
  if (!ALLOWED_PLAN_SLUGS.includes(planSlug as CheckoutPlanSlug)) return null;
  const priceId = PRICE_ENV_MAP[planSlug as CheckoutPlanSlug];
  return priceId || null;
}

/** Validates that a plan slug is one we can checkout for. */
export function isCheckoutSlug(s: string): s is CheckoutPlanSlug {
  return ALLOWED_PLAN_SLUGS.includes(s as CheckoutPlanSlug);
}
