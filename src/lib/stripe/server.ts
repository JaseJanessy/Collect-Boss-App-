import "server-only";

import Stripe from "stripe";
import { isProduction } from "@/lib/supabase/client";

export { getPriceId, isCheckoutSlug } from "@/lib/billing/catalog-server";
export type { CheckoutPlanSlug } from "@/lib/billing/catalog-server";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY ?? "";

/** Production and test Stripe credentials are deliberately non-interchangeable. */
export const isStripeConfigured =
  (isProduction && stripeSecretKey.startsWith("sk_live_"))
  || (!isProduction && stripeSecretKey.startsWith("sk_test_"));

let stripeClient: Stripe | null = null;

export function getStripeServer(): Stripe | null {
  if (!isStripeConfigured) return null;
  if (!stripeClient) stripeClient = new Stripe(stripeSecretKey, { typescript: true });
  return stripeClient;
}
